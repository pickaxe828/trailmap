import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Page, Visit } from '@trailmap/shared';
import { CompanionRequestError } from '../companion/client';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { enqueueJob, JobQueue, JOB_PRIORITY } from '../jobs/queue';
import { countUnseenNotes, markNotesSeen } from './badge';
import { NotesWrittenHooks } from './hooks';
import { wrapUpHandlers, type ModelRequester } from './handlers';
import { enqueueWrapUp } from './enqueue';

let db: TrailmapDb;
let now: number;
const settings = { paused: false, skippedHosts: [] as string[] };
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); now = 100_000; });
afterEach(async () => { await db.delete(); });

const expedition = (extra: Partial<Expedition> = {}): Expedition => ({
  id: 'expedition:v1', rootVisitId: 'v1', title: 'crdt', drivingQuestion: null, kind: 'learning',
  startedAt: 1000, endedAt: 9000, fieldNotes: null, userEdited: false, threadId: null, ...extra,
});
const visit = (id: string, host: string, extra: Partial<Visit> = {}): Visit => ({
  id, url: `https://${host}/${id}`, canonicalUrl: `https://${host}/${id}`, title: `Title ${id}`, tabId: 1,
  parentVisitId: null, transition: 'link', startedAt: 1000, activeMs: 70_000, scrollDepth: 0.8,
  engagement: 'read', expeditionId: 'expedition:v1', ...extra,
});
const page = (v: Visit, extra: Partial<Page> = {}): Page => ({
  canonicalUrl: v.canonicalUrl, text: `Body of ${v.id}`, textHash: `hash-${v.id}`, textRevision: 1, sourceUrl: v.url, sourceVisitId: v.id,
  summary: `Summary of ${v.id}`, takeaways: ['One', 'Two'], embedding: null, pageKind: 'article', enrichedAt: 5000, ...extra,
});

async function seed(extra: Partial<Expedition> = {}) {
  const read = visit('v1', 'learn.test');
  const bounced = visit('v2', 'unread.test', { engagement: 'bounced', startedAt: 2000, parentVisitId: 'v1' });
  await db.expeditions.put(expedition(extra));
  await db.visits.bulkPut([read, bounced]);
  await db.pages.bulkPut([page(read)]);
  await db.jobs.clear();
  await enqueueWrapUp(db, expedition(extra), now);
}

type Call = { task: string; input: string };
function fake(outputs: Record<string, unknown>, calls: Call[] = []): ModelRequester {
  return async (_db, payload, guard) => {
    if (!await guard.allow()) throw new CompanionRequestError('dispatch_cancelled', 'cancelled');
    calls.push({ task: payload.task, input: payload.input });
    return { output: outputs[payload.task] };
  };
}
const wrapUp = { title: 'How CRDTs delete', driving_question: 'How do CRDTs represent deletes?', kind: 'learning', merge_with: [] };
const notes = { found: 'With tombstones.', key_ideas: [{ idea: 'Deletes are markers', page: 'p1' }], trail: 'One page.', loose_ends: [] };

function queue(outputs: Record<string, unknown>, calls: Call[] = [], hooks = new NotesWrittenHooks()) {
  const handlers = wrapUpHandlers(db, () => settings, { request: fake(outputs, calls), now: () => now, hooks });
  const discard = async () => 'discard' as const;
  return new JobQueue(db, () => now, { page_enrichment: discard, concept_resolution: discard, merge_verdict: discard, ...handlers }, [db.expeditions]);
}
const drain = async (q: JobQueue) => { while (await q.runNext()) { /* drain */ } };

test('wrap-up stores the title, driving question and kind, then queues field notes for a learning Expedition', async () => {
  await seed();
  const calls: Call[] = [];
  const q = queue({ expedition_wrap_up: wrapUp, field_notes: notes }, calls);
  await q.runNext();
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({
    title: 'How CRDTs delete', drivingQuestion: 'How do CRDTs represent deletes?', kind: 'learning', wrappedUpAt: now,
  });
  expect((await db.jobs.toArray()).map(({ kind, status }) => [kind, status]).sort()).toEqual([
    ['expedition_wrap_up', 'done'], ['field_notes', 'pending'],
  ]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.input).toContain('Summary of v1');
  expect(calls[0]!.input).not.toContain('unread.test');
});

test('field notes are stored as Markdown, flagged unseen, and announced to the notes-written hook', async () => {
  await seed();
  const hooks = new NotesWrittenHooks();
  const written: string[] = [];
  hooks.register(async ({ expeditionId }) => { written.push(expeditionId); });
  await drain(queue({ expedition_wrap_up: wrapUp, field_notes: notes }, [], hooks));
  const stored = await db.expeditions.get('expedition:v1');
  expect(stored).toMatchObject({ unseenNotes: 1, notesWrittenAt: now, userEdited: false });
  expect(stored!.fieldNotes).toContain('## Question\n\nHow do CRDTs represent deletes?');
  expect(stored!.fieldNotes).toContain('- Deletes are markers ([Title v1](https://learn.test/v1))');
  expect(stored!.fieldNotes).toContain('- Opened but never read: [Title v2](https://unread.test/v2)');
  expect(written).toEqual(['expedition:v1']);
  expect(await countUnseenNotes(db)).toBe(1);
  await markNotesSeen(db, 'expedition:v1');
  expect(await countUnseenNotes(db)).toBe(0);
  expect((await db.expeditions.get('expedition:v1'))!.fieldNotes).toContain('## Question');
});

test('an errand gets a title but no field notes and no notes-written event', async () => {
  await seed();
  const hooks = new NotesWrittenHooks();
  let fired = 0;
  hooks.register(async () => { fired++; });
  const calls: Call[] = [];
  await drain(queue({ expedition_wrap_up: { ...wrapUp, title: 'Buy a desk lamp', kind: 'errand' } }, calls, hooks));
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({ title: 'Buy a desk lamp', kind: 'errand', fieldNotes: null });
  expect(calls.map(({ task }) => task)).toEqual(['expedition_wrap_up']);
  expect((await db.jobs.toArray()).map(({ kind }) => kind)).toEqual(['expedition_wrap_up']);
  expect(fired).toBe(0);
});

test('merge suggestions keep only real same-day Expeditions and are stored for the Journal', async () => {
  await seed();
  await db.expeditions.put(expedition({ id: 'expedition:other', rootVisitId: 'o', title: 'CRDT basics', startedAt: 500, endedAt: 800 }));
  await db.visits.put(visit('o', 'basics.test', { expeditionId: 'expedition:other', startedAt: 500 }));
  const calls: Call[] = [];
  const q = queue({ expedition_wrap_up: { ...wrapUp, merge_with: [
    { id: 'e1', reason: 'Same topic' }, { id: 'e7', reason: 'Made up' }, { id: 'e1', reason: 'Duplicate' },
  ] } }, calls);
  await q.runNext();
  expect(JSON.parse(calls[0]!.input).sameDay).toEqual([{ id: 'e1', title: 'CRDT basics', drivingQuestion: null }]);
  expect((await db.expeditions.get('expedition:v1'))!.mergeSuggestions).toEqual([{ expeditionId: 'expedition:other', reason: 'Same topic' }]);
});

test('a title the user chose and notes the user edited are never overwritten', async () => {
  await seed({ title: 'My own title', userEdited: true, fieldNotes: 'My notes' });
  await drain(queue({ expedition_wrap_up: wrapUp, field_notes: notes }));
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({
    title: 'My own title', fieldNotes: 'My notes', userEdited: true, drivingQuestion: 'How do CRDTs represent deletes?',
  });
  expect((await db.expeditions.get('expedition:v1'))!.unseenNotes).toBeUndefined();
});

test('a renamed Expedition that has no notes yet still gets them', async () => {
  await seed({ title: 'My own title', userEdited: true });
  await drain(queue({ expedition_wrap_up: wrapUp, field_notes: notes }));
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({ title: 'My own title', userEdited: true, unseenNotes: 1 });
  expect((await db.expeditions.get('expedition:v1'))!.fieldNotes).toContain('## Key ideas');
});

test('notes that cite no page we sent are rejected instead of stored', async () => {
  await seed();
  await db.expeditions.update('expedition:v1', { wrappedUpAt: now });
  await db.jobs.clear();
  await enqueueJob(db, { kind: 'field_notes', key: 'k', priority: JOB_PRIORITY.fieldNotes, payload: { expeditionId: 'expedition:v1', endedAt: 9000, revision: 0 } }, now);
  await drain(queue({ field_notes: { ...notes, key_ideas: [{ idea: 'Unsupported', page: 'p9' }] } }));
  expect((await db.expeditions.get('expedition:v1'))!.fieldNotes).toBeNull();
  expect((await db.jobs.toArray())[0]!.status).toBe('failed');
});

test('wrap-up waits for the Expedition Pages still being enriched', async () => {
  await seed();
  await db.pages.update('https://learn.test/v1', { enrichedAt: null, summary: null });
  await enqueueJob(db, { kind: 'page_enrichment', key: JSON.stringify(['https://learn.test/v1', 'hash-v1', 1]), priority: 0,
    payload: { canonicalUrl: 'https://learn.test/v1', textHash: 'hash-v1', textRevision: 1, visitId: 'v1' } }, now);
  const calls: Call[] = [];
  const handlers = wrapUpHandlers(db, () => settings, { request: fake({ expedition_wrap_up: wrapUp }, calls), now: () => now });
  const job = (await db.jobs.toArray()).find(({ kind }) => kind === 'expedition_wrap_up')!;
  expect(await handlers.expedition_wrap_up(job as never)).toEqual({ retryAt: now + 5_000 });
  expect(calls).toHaveLength(0);
});

test('closing the same Expedition twice queues one wrap-up', async () => {
  await db.expeditions.put(expedition());
  await enqueueWrapUp(db, expedition(), now);
  await enqueueWrapUp(db, expedition(), now + 1);
  expect(await db.jobs.count()).toBe(1);
});
