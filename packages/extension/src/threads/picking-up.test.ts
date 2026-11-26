import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Thread, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { detectDormantThread } from './picking-up';

const day = 86_400_000;
const at = 100 * day;
let db: ReturnType<typeof openTrailmapDb>;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); });
afterEach(() => db.delete());

async function seedThread(id: string, ageDays: number, overrides: Partial<Thread> = {}) {
  const lastActiveAt = at - ageDays * day;
  await db.threads.add({ id, title: id, question: null, status: 'active', lastActiveAt,
    livingNote: null, centroid: Int8Array.of(127, 0), conceptIds: [], ...overrides });
  await db.expeditions.bulkAdd([2, 1].map((days) => ({
    id: `${id}:${days}`, title: id, kind: 'learning', threadId: id, startedAt: lastActiveAt - days * day,
    endedAt: lastActiveAt - (days - 1) * day, drivingQuestion: null, fieldNotes: null, userEdited: false,
  } satisfies Expedition)));
}

const root: Visit = {
  id: 'root', title: 'replicated lists', tabId: 1, url: 'https://search.test/', canonicalUrl: 'https://search.test/',
  startedAt: at, parentVisitId: null, transition: 'search', activeMs: 0, engagement: 'bounced', scrollDepth: 0,
  expeditionId: 'current', expeditionEmbedding: Int8Array.of(127, 0),
};

test('a new root can match a dormant Thread but not active, done, expired or unrelated Threads', async () => {
  await seedThread('active', 0.5, { status: 'dormant' });
  await seedThread('done', 2, { status: 'done' });
  await seedThread('expired', 61);
  await seedThread('unrelated', 3, { centroid: Int8Array.of(0, 127) });
  expect(await detectDormantThread(db, root)).toBeUndefined();

  await seedThread('dormant', 4, { centroid: Int8Array.of(127, 60) });
  expect((await detectDormantThread(db, root))?.thread.id).toBe('dormant');
});

test('a previously read root Page can match a dormant Thread without an embedding', async () => {
  await seedThread('dormant', 4, { centroid: null });
  const page = { ...root, transition: 'typed', expeditionEmbedding: null } satisfies Visit;
  const prior = { ...page, id: 'prior', startedAt: at - 5 * day, expeditionId: 'dormant:1', engagement: 'read' } satisfies Visit;
  await db.visits.add({ ...prior, privacyBlocked: true });
  expect(await detectDormantThread(db, page)).toBeUndefined();
  await db.visits.put(prior);
  expect((await detectDormantThread(db, page))?.thread.id).toBe('dormant');
});
