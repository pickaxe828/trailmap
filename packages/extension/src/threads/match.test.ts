import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import type { Embedder } from '../embeddings/embedder';
import { JobQueue } from '../jobs/queue';
import { discardJobs } from '../jobs/testing';
import { enqueueThreadMatch, matchThread } from './match';
import { readDormantThreads } from './model';

const day = 86_400_000;
const now = () => 100 * day;
let db: ReturnType<typeof openTrailmapDb>;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); });
afterEach(() => db.delete());

const expedition = (id: string, title: string, age: number, kind: Expedition['kind'] = 'learning'): Expedition => ({
  id, title, kind, startedAt: now() - age * day - 1000, endedAt: now() - age * day,
  drivingQuestion: null, fieldNotes: 'Session notes', userEdited: false, threadId: null,
});

const embedder: Embedder = { async embed(texts) {
  return texts.map((text) => Float32Array.from(text.startsWith('Borderline') ? [0.9, 0.436] : text.startsWith('Related') ? [0.8, 0.6] :
    text.startsWith('Other') ? [0, 1] : [1, 0]));
} };

async function match(session: Expedition) {
  const written = { ...session, notesWrittenAt: now() };
  await db.expeditions.put(written);
  await enqueueThreadMatch(db, written, now());
  const queue = new JobQueue(db, now, { ...discardJobs, thread_match: matchThread(db, embedder, now) },
    [db.expeditions, db.threads, db.visits, db.concepts, db.conceptEvidence]);
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

test('a shared top concept makes a borderline embedding strong', async () => {
  const shared = { name: 'Tombstone', kind: 'concept' as const, embedding: null, gloss: 'A deletion marker' };
  await db.concepts.add({ id: 'concept', ...shared, aliases: [], exposure: 2, firstSeen: 0 });
  for (const expeditionId of ['first', 'second']) {
    const id = `visit:${expeditionId}`;
    const url = `https://learn.test/${id}`;
    await db.visits.add({ id, url, canonicalUrl: url, expeditionId, engagement: 'read', startedAt: now(), tabId: 1,
      parentVisitId: null, transition: 'typed', title: shared.name, activeMs: 75_000, scrollDepth: 1 } satisfies Visit);
    await db.conceptEvidence.add({ id, ...shared, conceptId: 'concept', visitId: id, canonicalUrl: url, startedAt: now(), role: 'explains' });
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
