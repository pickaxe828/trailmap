import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Note, Visit } from '@trailmap/shared';
import { readAtlas, readAtlasEvidence } from '../atlas/data';
import { forgetCascade } from '../corrections/forget';
import { createCorrections } from '../corrections/corrections';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import type { Embedder } from '../embeddings/embedder';
import { JobQueue } from '../jobs/queue';
import { discardJobs } from '../jobs/testing';
import { describeExpedition } from '../threads/match';
import { updateLivingNote } from '../threads/living-note';
import { newThread, refreshThread } from '../threads/model';
import { NOTES_DEBOUNCE_MS, readNotesSources } from './enqueue';
import { enrichNotes, type NotesRequester } from './handler';
import { buildNotesInput } from './input';

let db: TrailmapDb;
let now: number;
const on = { paused: false, skippedHosts: [] as string[] };
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); now = 1_000_000; });
afterEach(() => db.delete());

const expedition = (extra: Partial<Expedition> = {}): Expedition => ({
  id: 'e1', rootVisitId: 'v1', title: 'CRDTs', drivingQuestion: 'How do CRDTs delete?', kind: 'learning', startedAt: 10, endedAt: 900,
  fieldNotes: null, userEdited: false, threadId: null, ...extra,
});
const visit = (id: string, host: string, extra: Partial<Visit> = {}): Visit => ({
  id, url: `https://${host}/${id}`, canonicalUrl: `https://${host}/${id}`, title: id, tabId: 1, parentVisitId: null, transition: 'link',
  startedAt: 20, activeMs: 70_000, scrollDepth: 0.8, engagement: 'read', expeditionId: 'e1', ...extra,
});
const note = (nodeId: string, text: string): Note => ({ id: `note-${nodeId}`, nodeId, text, at: 5 });

const embedder: Embedder = { embed: async (texts) => texts.map((text) => Float32Array.from(
  text.startsWith('Tombstone') ? [1, 0, 0] : text.startsWith('Causal') ? [0, 1, 0] : [0, 0, 1])) };
const answer = { concepts: [
  { name: 'Tombstone', kind: 'concept', gloss: 'A marker for a deleted item', note: 'n0' },
  { name: 'Causal order', kind: 'concept', gloss: 'Order from happens-before', note: 'n1' },
  { name: 'Ghost', kind: 'concept', gloss: 'Cites a note that was never sent', note: 'n9' },
], relations: [{ from: 'Tombstone', to: 'Causal order', type: 'related_to' }] };

type Call = { task: string; input: string; expeditionId?: string; visitIds?: string[] };
function queue(calls: Call[] = [], settings: () => typeof on & { useMyNotes?: boolean } = () => on, output: unknown = answer) {
  const request: NotesRequester = async (_db, payload, guard) => {
    if (!await guard.allow()) throw new Error('not allowed');
    calls.push({ task: payload.task, input: payload.input, expeditionId: guard.expeditionId, visitIds: guard.visitIds });
    return { output };
  };
  return new JobQueue(db, () => now, { ...discardJobs, notes_enrichment: enrichNotes(db, settings, embedder, { request, now: () => now }) },
    [db.expeditions, db.visits, db.queries, db.notes, db.concepts, db.conceptEvidence, db.edges]);
}
const drain = async (q: JobQueue) => { while (await q.runNext()) { /* drain */ } };
const corrections = () => createCorrections({ db, now: () => now, newId: () => crypto.randomUUID() });

async function seed(extra: Partial<Expedition> = {}) {
  await db.expeditions.put(expedition(extra));
  await db.visits.bulkPut([visit('v1', 'learn.test'), visit('v2', 'blog.test', { startedAt: 30 }), visit('v3', 'bank.test', { startedAt: 40, privacyBlocked: true })]);
}

test('the model input holds only the user’s own notes; the setting and a pause switch it off; private stops never leave', async () => {
  await seed({ myNotes: 'Deletes need tombstones.' });
  await db.notes.bulkPut([note('v2', 'Causal order matters.'), note('v3', 'secret bank thing')]);
  const sources = (await readNotesSources(db, 'e1'))!;
  const built = buildNotesInput(sources, on)!;
  expect(JSON.parse(built.input)).toEqual({ notes: [{ ref: 'n0', text: 'Deletes need tombstones.' }, { ref: 'n1', text: 'Causal order matters.' }] });
  expect([...built.anchors]).toEqual([['n0', 'e1'], ['n1', 'v2']]);
  expect(built.provenance.visitIds).toEqual(['v2']);
  expect(buildNotesInput(sources, { ...on, useMyNotes: false })).toBeUndefined();
  expect(buildNotesInput(sources, { ...on, paused: true })).toBeUndefined();
  expect(buildNotesInput(sources, { ...on, skippedHosts: ['blog.test'] })?.anchors.has('n1')).toBe(false);
});

test('writing My notes queues one debounced pass; the concepts it finds are learned evidence that shows in the Atlas at once', async () => {
  await seed();
  await db.notes.put(note('v2', 'Causal order matters.'));
  await corrections().editMyNotes('e1', 'Deletes need tombstones.');
  now += 5_000;
  await corrections().editMyNotes('e1', 'Deletes need tombstones, kept until every replica saw them.');
  const jobs = await db.jobs.toArray();
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ kind: 'notes_enrichment', availableAt: now + NOTES_DEBOUNCE_MS });
  const calls: Call[] = [];
  const q = queue(calls);
  expect(await q.runNext()).toBe(false); // still inside the pause
  now += NOTES_DEBOUNCE_MS;
  await drain(q);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ task: 'notes_enrichment', expeditionId: 'e1', visitIds: ['v2'] });
  expect(calls[0]!.input).not.toContain('CRDTs'); // the title and question are not part of it

  const evidence = await db.conceptEvidence.toArray();
  expect(evidence.map(({ name, role, visitId, expeditionId }) => [name, role, visitId, expeditionId]).sort()).toEqual([
    ['Causal order', 'learned', 'v2', 'e1'], ['Tombstone', 'learned', 'e1', 'e1'],
  ]);
  const atlas = await readAtlas(db);
  expect(atlas.concepts.map(({ name, strength }) => [name, strength]).sort()).toEqual([['Causal order', 'learned'], ['Tombstone', 'learned']]);
  expect(atlas.edges.map(({ type, evidence: support }) => [type, support])).toEqual([['related_to', ['notes:e1']]]);
  const tombstone = atlas.concepts.find(({ name }) => name === 'Tombstone')!;
  expect(await readAtlasEvidence(db, tombstone.id)).toMatchObject({ learned: true, expeditions: [{ id: 'e1' }] });
});

test('a concept only seen on pages is not learned, and notes on an errand never reach the Atlas', async () => {
  await seed();
  await db.concepts.put({ id: 'seen', name: 'Seen twice', aliases: [], kind: 'concept', gloss: '', embedding: null, exposure: 2, firstSeen: 1 });
  await db.conceptEvidence.bulkPut(['v1', 'v2'].map((visitId, i) => ({ id: `s${i}`, conceptId: 'seen', name: 'Seen twice', kind: 'concept' as const,
    gloss: '', role: 'mentions' as const, salience: 'passing' as const, visitId, canonicalUrl: `https://learn.test/${visitId}`, startedAt: 20 + i, embedding: null })));
  await corrections().editMyNotes('e1', 'Deletes need tombstones.');
  now += NOTES_DEBOUNCE_MS;
  await drain(queue());
  const atlas = await readAtlas(db);
  expect(atlas.concepts.map(({ name, strength }) => [name, strength])).toEqual([['Tombstone', 'learned']]);
  expect(atlas.seen.map(({ name }) => name)).toEqual(['Seen twice']);
  await db.expeditions.update('e1', { kind: 'errand' });
  expect((await readAtlas(db)).concepts).toEqual([]);
});

test('with the setting off nothing is sent, and the audit log is not touched', async () => {
  await seed();
  await corrections().editMyNotes('e1', 'Deletes need tombstones.');
  now += NOTES_DEBOUNCE_MS;
  const calls: Call[] = [];
  await drain(queue(calls, () => ({ ...on, useMyNotes: false })));
  expect(calls).toEqual([]);
  expect(await db.conceptEvidence.count()).toBe(0);
  expect(await db.sentToModel.count()).toBe(0);
});

test('editing or clearing My notes replaces what they taught; stop notes stay input', async () => {
  await seed();
  await corrections().editMyNotes('e1', 'Deletes need tombstones.');
  now += NOTES_DEBOUNCE_MS;
  await drain(queue());
  expect(await db.concepts.count()).toBe(1); // n1 names no stop note, so its concept is dropped
  await corrections().editMyNotes('e1', '');
  expect(await db.conceptEvidence.count()).toBe(0);
  expect(await db.concepts.count()).toBe(0);
  expect(await db.edges.count()).toBe(0);
  expect((await db.expeditions.get('e1'))!.myNotes).toBeUndefined();
});

test('Forget takes learned evidence along with the Expedition, or with the stop whose note taught it', async () => {
  await seed();
  await db.notes.put(note('v2', 'Causal order matters.'));
  await corrections().editMyNotes('e1', 'Deletes need tombstones.');
  now += NOTES_DEBOUNCE_MS;
  await drain(queue());
  // Forgetting the stop: its concept goes, My notes' concept stays, and the shared relation is rebuilt by a new pass.
  await forgetCascade(db, { kind: 'forget-page', visitIds: ['v2'], now: () => now, newId: () => crypto.randomUUID() });
  expect((await db.concepts.toArray()).map(({ name }) => name)).toEqual(['Tombstone']);
  expect(await db.edges.count()).toBe(0);
  expect(await db.notes.count()).toBe(0);
  // My notes remain, so a new pass is queued to rebuild the relations without the forgotten note.
  expect((await db.jobs.toArray()).map(({ kind }) => kind)).toEqual(['notes_enrichment']);
  // Forgetting the Expedition removes the rest, and the audit rows that quoted it.
  await db.sentToModel.put({ id: 'a1', at: 1, task: 'notes_enrichment', expeditionId: 'e1', provider: 'p', model: 'm', instructions: 'i',
    input: [{ role: 'user', content: 'Deletes need tombstones.' }] });
  await forgetCascade(db, { kind: 'forget-expedition', visitIds: ['v1'], expeditionIds: ['e1'], now: () => now, newId: () => crypto.randomUUID() });
  expect(await db.conceptEvidence.count()).toBe(0);
  expect(await db.concepts.count()).toBe(0);
  expect(JSON.stringify(await Promise.all(db.tables.map((t) => t.toArray())))).not.toContain('tombstones');
});

test('thread matching describes an Expedition with My notes ahead of the concepts, only when the setting allows it', async () => {
  await seed({ myNotes: 'Deletes need   tombstones.', fieldNotes: 'Generated field notes text' });
  const described = await describeExpedition(db, (await db.expeditions.get('e1'))!);
  expect(described.text).toBe('CRDTs\nHow do CRDTs delete?\nDeletes need tombstones.');
  expect((await describeExpedition(db, (await db.expeditions.get('e1'))!, { useMyNotes: false })).text).toBe('CRDTs\nHow do CRDTs delete?');
});

test('the living note receives My notes separately, first, and never when the setting is off', async () => {
  await db.threads.add(newThread('t', 10));
  for (const [i, myNotes] of [undefined, 'My own take on Tuesday'].entries()) {
    const id = `s${i}`;
    await db.expeditions.add({ ...expedition({ id, title: id, startedAt: i, endedAt: i + 1, fieldNotes: `Notes ${i}`, threadId: 't', myNotes }) });
    await db.visits.add(visit(`v-${id}`, 'learn.test', { expeditionId: id }));
  }
  await db.transaction('rw', [db.threads, db.expeditions, db.jobs], () => refreshThread(db, 't', 10));
  const seen: string[] = [];
  const run = async (settings: { useMyNotes?: boolean }) => {
    await db.threads.update('t', { livingNote: null, notedExpeditionIds: [], noteRevision: 5 });
    await db.jobs.clear();
    await db.transaction('rw', [db.threads, db.expeditions, db.jobs], async () => refreshThread(db, 't', 10));
    const q = new JobQueue(db, () => 10, { ...discardJobs, living_note: updateLivingNote(db, () => ({ ...on, ...settings }), {
      now: () => 10, request: async (_db, payload) => { seen.push(payload.input); return { output: { markdown: 'x' } }; } }) },
    [db.threads, db.expeditions, db.visits, db.pages]);
    await drain(q);
  };
  await run({});
  expect(seen.map((input) => JSON.parse(input))).toEqual([{ livingNote: null, fieldNotes: 'Notes 0' }, { livingNote: 'x', myNotes: 'My own take on Tuesday', fieldNotes: 'Notes 1' }]);
  expect(Object.keys(JSON.parse(seen[1]!))[0]).toBe('myNotes');
  seen.length = 0;
  await run({ useMyNotes: false });
  expect(seen.join()).not.toContain('Tuesday');
});
