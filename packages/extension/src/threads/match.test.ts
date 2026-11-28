import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Page, Visit } from '@trailmap/shared';
import { enqueueConceptResolution } from '../concepts/enqueue';
import { openTrailmapDb } from '../db/db';
import type { Embedder } from '../embeddings/embedder';
import { JobQueue } from '../jobs/queue';
import { discardJobs } from '../jobs/testing';
import { enqueueThreadMatch, matchThread } from './match';
import { readDormantThreads } from './model';

const day = 86_400_000;
let clock = 100 * day;
const now = () => clock;
let db: ReturnType<typeof openTrailmapDb>;
beforeEach(() => { resolutionStalled = false; clock = 100 * day; db = openTrailmapDb(crypto.randomUUID()); });
afterEach(() => db.delete());

const expedition = (id: string, title: string, age: number, kind: Expedition['kind'] = 'learning'): Expedition => ({
  id, title, kind, startedAt: now() - age * day - 1000, endedAt: now() - age * day,
  drivingQuestion: null, fieldNotes: 'Session notes', userEdited: false, threadId: null,
});

let embedderDown = false;
const embedder: Embedder = { async embed(texts) {
  if (embedderDown) throw new Error('offline');
  return texts.map((text) => Float32Array.from(text.startsWith('Borderline') ? [0.9, 0.436] : text.startsWith('Related') ? [0.8, 0.6] :
    text.startsWith('Other') ? [0, 1] : [1, 0]));
} };

let resolutionStalled = false;
async function match(session: Expedition) {
  const written = { ...session, notesWrittenAt: now() };
  await db.expeditions.put(written);
  await enqueueThreadMatch(db, written, now());
  const queue = new JobQueue(db, now, { ...discardJobs, thread_match: matchThread(db, embedder, now), ...(resolutionStalled ? { concept_resolution: async () => ({ retryAt: now() + day }) } : {}) },
    [db.expeditions, db.threads, db.visits, db.concepts, db.conceptEvidence, db.threadMatchRuns]);
  while (await queue.runNext()) { /* drain matching work */ }
  return db.expeditions.get(session.id);
}

test('a strong second session creates one thread; a first session stays alone', async () => {
  expect((await match(expedition('first', 'Replicated lists', 2)))?.threadId).toBeNull();
  expect(await db.threads.count()).toBe(0);
  const threadId = (await match(expedition('second', 'Replicated list deletes', 0)))?.threadId;
  expect(threadId).toBeTruthy();
  expect((await db.expeditions.get('first'))?.threadId).toBe(threadId!);
  expect((await match(expedition('third', 'Replicated list GC', 0)))?.threadId).toBe(threadId!);
  expect(await db.threads.count()).toBe(1);
  expect(await readDormantThreads(db, now())).toHaveLength(0);
  expect((await readDormantThreads(db, now() + day)).map(({ id }) => id)).toEqual([threadId!]);
  expect(await readDormantThreads(db, now() + 61 * day)).toHaveLength(0);
});

test('a possible match suggests a previous session without attaching either', async () => {
  await match(expedition('first', 'Replicated lists', 60));
  expect(await match(expedition('second', 'Related list algorithms', 0))).toMatchObject({
    threadId: null, threadSuggestion: { kind: 'expedition', id: 'first' },
  });
  expect(await db.threads.count()).toBe(0);
});

test('thread matching skips a dismissed target even when it is the strongest match', async () => {
  await match(expedition('first', 'Replicated lists', 2));
  const threadId = (await match(expedition('second', 'Replicated list deletes', 1)))!.threadId!;
  expect(threadId).toBeTruthy();
  const result = await match({ ...expedition('third', 'Replicated list GC', 0),
    dismissedSuggestions: [{ kind: 'thread', id: threadId }] });
  expect(result).toMatchObject({ threadId: null });
  expect(result?.threadSuggestion).toBeUndefined();
});

test('a shared top concept makes a borderline embedding strong', async () => {
  const shared = { name: 'Tombstone', kind: 'concept' as const, embedding: null, gloss: 'A deletion marker' };
  await db.concepts.add({ id: 'concept', ...shared, aliases: [], exposure: 2, firstSeen: 0 });
  for (const expeditionId of ['first', 'second']) {
    const id = `visit:${expeditionId}`;
    const url = `https://learn.test/${id}`;
    await db.visits.add({ id, url, canonicalUrl: url, expeditionId, engagement: 'read', startedAt: now(), tabId: 1,
      parentVisitId: null, transition: 'typed', title: shared.name, activeMs: 75_000, scrollDepth: 1 } satisfies Visit);
    await db.conceptEvidence.add({ id, ...shared, conceptId: 'concept', visitId: id, canonicalUrl: url, startedAt: now(), role: 'explains', salience: 'supporting' });
  }
  await match(expedition('first', 'Replicated lists', 1));
  const matched = await match(expedition('second', 'Borderline deletion', 0));
  expect(matched?.threadId).toBeTruthy();
  expect((await db.threads.get(matched!.threadId!))?.conceptIds).toEqual(['concept']);
});

test('no match when the candidate is unrelated, older than 60 days, or an errand', async () => {
  await match(expedition('old', 'Replicated lists', 61));
  await match(expedition('unrelated', 'Other topic', 2));
  await match(expedition('errand', 'Replicated list errands', 1, 'errand'));
  const result = await match(expedition('current', 'Replicated list deletes', 0));
  expect(result?.threadId).toBeNull();
  expect(result?.threadSuggestion).toBeUndefined();
  expect(await db.threads.count()).toBe(0);
});

const page = (canonicalUrl: string): Page => ({ canonicalUrl, title: 'Page', text: '', textHash: 'h', summary: null, takeaways: [], embedding: null,
  pageKind: null, enrichedAt: 5, enrichmentVisitId: `visit:${canonicalUrl}`, conceptMentions: [{ name: 'Tombstone', kind: 'concept', role: 'explains', salience: 'supporting', gloss: 'g' }] } as unknown as Page);

async function readPage(expeditionId: string, canonicalUrl: string) {
  await db.visits.add({ id: `visit:${canonicalUrl}`, url: canonicalUrl, canonicalUrl, expeditionId, engagement: 'read', startedAt: now(), tabId: 1,
    parentVisitId: null, transition: 'typed', title: 'Page', activeMs: 75_000, scrollDepth: 1 } satisfies Visit);
  const resolution = page(canonicalUrl);
  await db.pages.put(resolution);
  await enqueueConceptResolution(db, resolution, now());
}

test('thread matching waits for concept resolution of the Expedition\'s pages, then gives up after 15 minutes', async () => {
  await readPage('current', 'https://learn.test/read');
  resolutionStalled = true;
  expect(await match(expedition('current', 'Replicated list deletes', 0))).toMatchObject({ threadId: null });
  expect((await db.expeditions.get('current'))?.threadSignature).toBeUndefined();
  expect(await db.threadMatchRuns.get('current')).toMatchObject({ outcome: 'waiting', reason: 'waiting-on-concepts' });
  clock += 16 * 60_000;
  const queue = new JobQueue(db, now, { ...discardJobs, thread_match: matchThread(db, embedder, now) },
    [db.expeditions, db.threads, db.visits, db.concepts, db.conceptEvidence, db.threadMatchRuns]);
  while (await queue.runNext()) { /* the unresolved page no longer holds matching back */ }
  expect((await db.expeditions.get('current'))?.threadSignature).toBeDefined();
  expect(await db.threadMatchRuns.get('current')).toMatchObject({ outcome: 'none' });
});

test('a stored signature is embedded again when the Expedition is described differently', async () => {
  await match(expedition('first', 'Replicated lists', 2));
  await db.expeditions.update('first', { title: 'Other topic' });
  const second = await match(expedition('second', 'Replicated list deletes', 0));
  expect(second?.threadId).toBeNull();
  expect(second?.threadSuggestion).toBeUndefined();
});

test('every run is recorded with its candidates and the reason, and never with titles or text', async () => {
  await match(expedition('first', 'Replicated lists', 2));
  expect(await db.threadMatchRuns.get('first')).toMatchObject({ outcome: 'none', reason: 'no-candidates', candidates: [] });
  await match(expedition('far', 'Other topic', 1));
  expect(await db.threadMatchRuns.get('far')).toMatchObject({ outcome: 'none', reason: 'below-suggestion-band',
    candidates: [{ kind: 'expedition', id: 'first', similarity: 0, shared: 0, band: 0 }] });
  await match(expedition('related', 'Related list algorithms', 0));
  const suggested = await db.threadMatchRuns.get('related');
  expect(suggested).toMatchObject({ outcome: 'suggested', reason: 'suggestion-band', candidates: [{ id: 'first', band: 1 }, { id: 'far', band: 1 }] });
  expect(JSON.stringify(suggested)).not.toMatch(/Replicated|Related|Session notes/);
  await match(expedition('same', 'Replicated list deletes', 0));
  expect(await db.threadMatchRuns.get('same')).toMatchObject({ outcome: 'joined', reason: 'strong-match' });
});

test('an unavailable Embedder is recorded and retried', async () => {
  embedderDown = true;
  try { await match(expedition('first', 'Replicated lists', 1)); } finally { embedderDown = false; }
  expect(await db.threadMatchRuns.get('first')).toMatchObject({ outcome: 'waiting', reason: 'embedder-unavailable' });
});
