import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import type { Embedder } from '../embeddings/embedder';
import { ExpeditionRecorder } from './expedition-recorder';

let db: ReturnType<typeof openTrailmapDb>;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); });
afterEach(() => db.delete());

const root: Visit = {
  id: 'root', url: 'https://example.test/', canonicalUrl: 'https://example.test/', title: 'Distributed systems',
  tabId: 1, parentVisitId: null, transition: 'typed', startedAt: 1000,
  activeMs: 0, scrollDepth: 0, engagement: 'bounced', expeditionId: null, segmentationPending: 1,
};
const embedder: Embedder = {
  async embed(texts) {
    return texts.map((text) => text === 'Distributed systems' ? Float32Array.of(1, 0) : Float32Array.of(0, 1));
  },
};

test('a restarted ExpeditionRecorder assigns pending Visits and incorporates linked pages into the centroid', async () => {
  await db.visits.put(root);
  await new ExpeditionRecorder({ db, embedder, now: () => 1000 }).sync();

  const link: Visit = {
    ...root, id: 'link', parentVisitId: root.id, transition: 'link', startedAt: 2000, title: 'Conflict-free replication',
  };
  const related: Visit = {
    ...root, id: 'related', startedAt: 3000, tabId: 2, title: 'Conflict-free replication',
  };
  await db.visits.bulkPut([related, link]);
  await new ExpeditionRecorder({ db, embedder, now: () => 3000 }).sync();

  const assigned = await db.visits.toArray();
  const expedition = await db.expeditions.where('startedAt').equals(root.startedAt).first();
  expect(expedition).toBeDefined();
  expect(assigned.map((visit) => visit.expeditionId)).toEqual([expedition!.id, expedition!.id, expedition!.id]);
  expect(await db.expeditions.count()).toBe(1);
});

test('previous-session Expeditions close at last reading time on wake, without closing current-session Expeditions or duplicating jobs', async () => {
  await db.visits.put({ ...root, activeMs: 2000, lastActiveAt: 9000 });
  await new ExpeditionRecorder({ db, embedder, now: () => 9000 }).sync();
  const current = { ...root, id: 'current', title: 'Indoor gardening', startedAt: 11_000 };
  await db.visits.put(current);
  const options = { db, embedder, now: () => 12_000 };
  for (let wake = 0; wake < 2; wake++) {
    const recorder = new ExpeditionRecorder(options);
    await recorder.recover(10_000);
    await recorder.sync();
  }
  expect(await db.expeditions.get('expedition:root')).toMatchObject({ endedAt: 9000 });
  expect(await db.expeditions.get('expedition:current')).toMatchObject({ endedAt: null });
  expect((await db.jobs.toArray()).map(({ kind, payload }) => [kind, payload])).toEqual([
    ['expedition_wrap_up', { expeditionId: 'expedition:root', endedAt: 9000, revision: 0 }],
  ]);
});

test('the startup sweep includes a pending linked Visit in the previous Expedition before closing it', async () => {
  await db.visits.put(root);
  await new ExpeditionRecorder({ db, embedder, now: () => 1000 }).sync();
  await db.visits.put({ ...root, id: 'pending', parentVisitId: root.id, transition: 'link', startedAt: 8000 });
  const recorder = new ExpeditionRecorder({ db, embedder, now: () => 10_000 });
  await recorder.recover(10_000);
  expect(await db.expeditions.toArray()).toMatchObject([{ id: 'expedition:root', endedAt: 8000 }]);
  expect((await db.visits.get('pending'))?.expeditionId).toBe('expedition:root');
});

test('a startup sweep leaves current-session reading alone until capture can checkpoint it', async () => {
  await db.visits.put(root);
  await new ExpeditionRecorder({ db, embedder, now: () => 1000 }).sync();
  const recorder = new ExpeditionRecorder({ db, embedder, now: () => 30 * 60_000 });
  await recorder.recover(1000);
  expect(await db.expeditions.get('expedition:root')).toMatchObject({ endedAt: null });
  expect(await db.jobs.count()).toBe(0);
});

test('starting a new topic closes the older inactive Expedition but leaves a recently read one open', async () => {
  const minute = 60_000;
  let now = 3 * minute;
  let topicSwitchMs = 15 * minute;
  const recorder = new ExpeditionRecorder({ db, embedder: {
    async embed(texts) {
      return texts.map((text) => text === root.title ? Float32Array.of(1, 0, 0)
        : text === 'Indoor gardening' ? Float32Array.of(0, 1, 0) : Float32Array.of(0, 0, 1));
    },
  }, now: () => now, timing: () => ({ inactivityMs: 20 * minute, topicSwitchMs }) });
  await db.visits.bulkPut([
    { ...root, startedAt: minute },
    { ...root, id: 'garden', title: 'Indoor gardening', startedAt: 3 * minute },
  ]);
  await recorder.sync();

  // Reading in the garden continued even though it received no new Visits.
  await db.visits.update('garden', { lastActiveAt: 11 * minute, activeMs: minute });
  now = 12 * minute;
  topicSwitchMs = 10 * minute;
  await db.visits.put({ ...root, id: 'bread', title: 'Sourdough baking', startedAt: now });
  await recorder.sync();

  expect(await db.expeditions.get('expedition:root')).toMatchObject({ endedAt: minute });
  expect(await db.expeditions.get('expedition:garden')).toMatchObject({ endedAt: null });
  expect(await db.expeditions.get('expedition:bread')).toMatchObject({ endedAt: null });
  expect((await db.jobs.toArray()).map(({ payload }) => payload)).toEqual([
    { expeditionId: 'expedition:root', endedAt: minute, revision: 0 },
  ]);
});

test('closing at the idle deadline ends every open Expedition once and a later link starts a new one', async () => {
  const second = { ...root, id: 'other-root', title: 'Indoor gardening', tabId: 2, startedAt: 2000 };
  const closed: (string | undefined)[][] = [];
  const options = { db, embedder, now: () => 1_802_001, onClosed: (expeditions: { rootVisitId?: string }[]) => {
    closed.push(expeditions.map(({ rootVisitId }) => rootVisitId).sort());
  } };
  await db.visits.bulkPut([root, second]);
  const recorder = new ExpeditionRecorder(options);
  await recorder.close(1_802_000);
  const restarted = new ExpeditionRecorder(options);
  await restarted.close(1_802_000);

  const link = { ...root, id: 'after-idle', parentVisitId: root.id, transition: 'link' as const, startedAt: 1_802_001 };
  await db.visits.put(link);
  await restarted.sync();

  expect(closed).toEqual([[second.id, root.id]]);
  const expeditions = await db.expeditions.toArray();
  expect(expeditions.find(({ rootVisitId }) => rootVisitId === root.id)?.endedAt).toBe(root.startedAt);
  expect(expeditions.find(({ rootVisitId }) => rootVisitId === link.id)?.endedAt).toBeNull();
});

test('a missing page title can arrive after assignment without moving its Visit', async () => {
  await db.visits.put({ ...root, title: '' });
  const recorder = new ExpeditionRecorder({ db, embedder, now: () => 10_000 });
  await recorder.sync();
  expect((await db.expeditions.where('startedAt').equals(root.startedAt).first())?.title).toBe('example.test');
  await db.visits.update(root.id, { title: root.title, segmentationPending: 1 });
  await recorder.sync();
  expect(await db.expeditions.where('startedAt').equals(root.startedAt).first()).toMatchObject({ title: root.title, centroid: Int8Array.of(127, 0) });
});

test('pending parent and child Visits captured in the same millisecond still share an Expedition', async () => {
  const child = { ...root, id: 'first-in-index', transition: 'link' as const, parentVisitId: root.id, title: 'Different topic' };
  await db.visits.bulkPut([root, child]);
  await new ExpeditionRecorder({ db, embedder, now: () => root.startedAt }).sync();
  expect(await db.expeditions.count()).toBe(1);
  expect((await db.visits.get(child.id))?.expeditionId).toBe((await db.visits.get(root.id))?.expeditionId);
});

test('closing queues one wrap-up per Expedition in the closure, and Wrap up closes only the chosen one', async () => {
  const second = { ...root, id: 'other-root', title: 'Indoor gardening', tabId: 2, startedAt: 2000 };
  await db.visits.bulkPut([root, second]);
  const recorder = new ExpeditionRecorder({ db, embedder, now: () => 5000 });
  await recorder.sync();
  await recorder.close(4000, 'expedition:other-root');
  expect((await db.jobs.toArray()).map(({ kind, payload }) => [kind, payload])).toEqual([
    ['expedition_wrap_up', { expeditionId: 'expedition:other-root', endedAt: second.startedAt, revision: 0 }],
  ]);
  expect((await db.expeditions.get('expedition:root'))!.endedAt).toBeNull();
  await recorder.close(6000);
  await recorder.close(6000);
  expect((await db.jobs.toArray()).map(({ payload }) => (payload as { expeditionId: string }).expeditionId).sort())
    .toEqual(['expedition:other-root', 'expedition:root']);
});
