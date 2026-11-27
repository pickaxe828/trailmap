import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Page, Visit } from '@trailmap/shared';
import { CompanionRequestError } from '../companion/client';
import { createCorrections } from '../corrections/corrections';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { enqueueJob, JobQueue, JOB_PRIORITY } from '../jobs/queue';
import { countUnseenNotes, markNotesSeen } from './badge';
import { NotesWrittenHooks } from './hooks';
import { discardJobs } from '../jobs/testing';
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

function queueWith(request: ModelRequester, hooks = new NotesWrittenHooks()) {
  const handlers = wrapUpHandlers(db, () => settings, { request, now: () => now, hooks });
  return new JobQueue(db, () => now, { ...discardJobs, ...handlers }, [db.expeditions, db.visits, db.pages, db.highlights, db.queries]);
}
const queue = (outputs: Record<string, unknown>, calls?: Call[], hooks?: NotesWrittenHooks) => queueWith(fake(outputs, calls), hooks);
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
  expect(stored!.fieldNotes).not.toContain('unread.test');
  expect(stored!.unreadStops).toEqual([{ visitId: 'v2', title: 'Title v2', url: 'https://unread.test/v2' }]);
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

test('Wrap up classifies and titles a read Visit without Page text, and handles a bounced-only Expedition locally', async () => {
  await seed();
  await db.pages.clear();
  const calls: Call[] = [];
  const result = { ...wrapUp, title: 'Look up a delivery', kind: 'errand' };
  await drain(queue({ expedition_wrap_up: result }, calls));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.input).toContain('Title v1');
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({ title: 'Look up a delivery', kind: 'errand', wrappedUpAt: now });

  await seed();
  await db.pages.clear();
  await db.visits.update('v1', { engagement: 'bounced', title: 'Bounced fixture' });
  calls.length = 0;
  await drain(queue({ expedition_wrap_up: result }, calls));
  expect(calls).toEqual([]);
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({ title: 'Bounced fixture', kind: 'unclassified', wrappedUpAt: now });
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

test('wrap-up respects manual classification and never offers a dismissed pair again', async () => {
  await seed({ kind: 'errand', kindOverride: true });
  const other = 'expedition:other';
  await db.expeditions.put(expedition({ id: other, rootVisitId: 'o', title: 'CRDT basics', startedAt: 500, endedAt: 800,
    dismissedSuggestions: [{ kind: 'expedition', id: 'expedition:v1' }] }));
  await db.visits.put(visit('o', 'basics.test', { expeditionId: other, startedAt: 500 }));
  const calls: Call[] = [];
  await drain(queue({ expedition_wrap_up: { ...wrapUp, merge_with: [{ id: 'e1', reason: 'Same topic' }] } }, calls));
  expect(JSON.parse(calls[0]!.input).sameDay).toEqual([]);
  expect(calls.map(({ task }) => task)).toEqual(['expedition_wrap_up']);
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({ kind: 'errand', mergeSuggestions: [] });
});

test('a wrap-up audit includes the selected stop and all sources behind same-day context', async () => {
  await seed();
  const other = 'expedition:other';
  const root = visit('other', 'other.test', { expeditionId: other });
  const detail = visit('detail', 'docs.test', { expeditionId: other });
  await db.expeditions.add(expedition({ id: other, rootVisitId: root.id, wrappedUpAt: 500,
    wrapUpSource: { visitIds: [root.id, detail.id], canonicalUrls: [root.canonicalUrl, detail.canonicalUrl] } }));
  await db.visits.bulkAdd([root, detail]);
  await queueWith(async (_db, payload, guard) => {
    expect(await guard.allow()).toBe(true);
    expect(JSON.parse(payload.input).sameDay).toHaveLength(1);
    expect(guard.visitIds?.slice().sort()).toEqual(['detail', 'other', 'v1']);
    return { output: wrapUp };
  }).runNext();
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({ title: wrapUp.title });
});

test('an in-flight wrap-up cannot commit after a same-day source is forgotten', async () => {
  await seed();
  const other = 'expedition:other';
  await db.expeditions.add(expedition({ id: other, rootVisitId: 'o', title: 'Forgotten subject' }));
  await db.visits.add(visit('o', 'forgotten.test', { expeditionId: other }));
  const corrections = createCorrections({ db, now: () => now, newId: () => crypto.randomUUID() });
  await queueWith(async (_db, payload, guard) => {
    expect(await guard.allow()).toBe(true);
    expect(payload.input).toContain('Forgotten subject');
    await corrections.forgetSite('forgotten.test');
    return { output: { ...wrapUp, title: 'Forgotten subject' } };
  }).runNext();
  expect(await db.expeditions.get('expedition:v1')).toMatchObject({ title: 'crdt', drivingQuestion: null });
});

test('a title the user chose is never overwritten, and generated notes never touch My notes', async () => {
  await seed({ title: 'My own title', userEdited: true, myNotes: 'My notes', myNotesAt: 50 });
  await drain(queue({ expedition_wrap_up: wrapUp, field_notes: notes }));
  const stored = (await db.expeditions.get('expedition:v1'))!;
  expect(stored).toMatchObject({ title: 'My own title', myNotes: 'My notes', myNotesAt: 50, userEdited: true, unseenNotes: 1,
    drivingQuestion: 'How do CRDTs represent deletes?' });
  expect(stored.fieldNotes).toContain('## Key ideas');
});

test('regenerating notes replaces the generated field notes and keeps My notes, even when saved mid-flight', async () => {
  await seed({ fieldNotes: 'Previously generated notes' });
  const corrections = createCorrections({ db, now: () => now, newId: () => 'note-edit' });
  await drain(queueWith(async (_db, payload, guard) => {
    expect(await guard.allow()).toBe(true);
    if (payload.task === 'expedition_wrap_up') return { output: wrapUp };
    await corrections.editMyNotes('expedition:v1', 'What I took from it');
    return { output: notes };
  }));
  const stored = (await db.expeditions.get('expedition:v1'))!;
  expect(stored.myNotes).toBe('What I took from it');
  expect(stored.fieldNotes).toContain('## Key ideas');
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

const symbolOnly = { ...wrapUp, title: 'ˤ', driving_question: 'What is the pharyngealization mark ˤ in IPA?' };

test('a symbol-only title is retried once with a corrective note, and the worded title is stored', async () => {
  await seed();
  const titles = [symbolOnly, { ...symbolOnly, title: 'ˤ: the pharyngealization mark in IPA' }];
  const calls: { instructions: string }[] = [];
  const q = queueWith(async (_db, payload) => {
    calls.push({ instructions: payload.instructions });
    return { output: payload.task === 'expedition_wrap_up' ? titles.shift() : notes };
  });
  await q.runNext();
  expect((await db.expeditions.get('expedition:v1'))!.title).toBe('ˤ: the pharyngealization mark in IPA');
  expect(calls).toHaveLength(2);
  expect(calls[0]!.instructions).toContain('readable words');
  expect(calls[1]!.instructions).toContain('previous title');
});

test('when the retry is still symbol-only, the driving question is appended', async () => {
  await seed();
  const calls: Call[] = [];
  await queue({ expedition_wrap_up: symbolOnly }, calls).runNext();
  expect(calls).toHaveLength(2);
  expect((await db.expeditions.get('expedition:v1'))!.title).toBe('ˤ: What is the pharyngealization mark ˤ in IPA?');
});

test('with no driving question the first search text is appended', async () => {
  await seed();
  await db.visits.put(visit('v3', 'www.google.com', { url: 'https://www.google.com/search?q=pharyngealization', canonicalUrl: 'https://www.google.com/search?q=pharyngealization', startedAt: 500 }));
  await db.queries.put({ id: 'q1', visitId: 'v3', expeditionId: 'expedition:v1', q: 'pharyngealization', engine: 'google', at: 500 });
  await queue({ expedition_wrap_up: { ...symbolOnly, driving_question: '' } }).runNext();
  expect((await db.expeditions.get('expedition:v1'))!.title).toBe('ˤ: pharyngealization');
});

test('the local fallback title gets the same guard', async () => {
  await seed();
  await db.pages.clear();
  await db.visits.update('v1', { engagement: 'bounced', title: 'ˤ' });
  await queue({}).runNext();
  expect((await db.expeditions.get('expedition:v1'))!.title).toBe('ˤ: learn.test');
});
