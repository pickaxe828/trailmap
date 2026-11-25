import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { createCorrections } from './corrections';

let db: ReturnType<typeof openTrailmapDb>;
let ids: number;
let time: number;
const corrections = () => createCorrections({ db, now: () => ++time, newId: () => `id-${++ids}` });
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); ids = 0; time = 1_000; });
afterEach(() => db.delete());

const visit = (id: string, extra: Partial<Visit> = {}): Visit => ({
  id, url: `https://${id}.example/`, canonicalUrl: `https://${id}.example/`, title: `Title ${id}`, tabId: 1,
  parentVisitId: null, transition: 'link', startedAt: 100, activeMs: 0, scrollDepth: 0, engagement: 'read',
  expeditionId: 'e1', ...extra,
});
const expedition = (id: string, extra: Partial<Expedition> = {}): Expedition => ({
  id, rootVisitId: undefined, centroid: null, title: `Expedition ${id}`, drivingQuestion: null, kind: 'learning',
  startedAt: 100, endedAt: null, fieldNotes: null, userEdited: false, threadId: null, ...extra,
});

test('starring a Visit and noting it persist and are logged with before and after', async () => {
  await db.expeditions.put(expedition('e1'));
  await db.visits.put(visit('a'));
  const c = corrections();

  await c.star('a', true);
  await c.note('a', 'worth rereading');
  await c.note('a', 'definitely rereading');

  expect((await db.visits.get('a'))?.starred).toBe(true);
  expect((await db.notes.where('nodeId').equals('a').toArray()).map((n) => n.text)).toEqual(['definitely rereading']);
  const log = await db.corrections.orderBy('at').toArray();
  expect(log.map(({ kind, before, after }) => ({ kind, before, after }))).toEqual([
    { kind: 'star', before: { starred: false }, after: { starred: true } },
    { kind: 'note', before: { text: null }, after: { text: 'worth rereading' } },
    { kind: 'note', before: { text: 'worth rereading' }, after: { text: 'definitely rereading' } },
  ]);

  await c.star('a', false);
  expect((await db.visits.get('a'))?.starred).toBeUndefined();
});

test('renaming an Expedition marks it user-edited and logs the title change', async () => {
  await db.expeditions.put(expedition('e1'));
  await corrections().rename('e1', '  CRDT deletes ');
  expect(await db.expeditions.get('e1')).toMatchObject({ title: 'CRDT deletes', userEdited: true });
  expect((await db.corrections.toArray())[0]).toMatchObject({
    kind: 'rename', before: { title: 'Expedition e1' }, after: { title: 'CRDT deletes' },
  });
});

async function seedTrail() {
  await db.expeditions.put(expedition('e1', { rootVisitId: 'a', title: 'CRDTs' }));
  await db.visits.bulkPut([
    visit('a', { startedAt: 100, transition: 'search', expeditionEmbedding: Int8Array.of(100, 0) }),
    visit('b', { startedAt: 200, parentVisitId: 'a', expeditionEmbedding: Int8Array.of(0, 100) }),
    visit('c', { startedAt: 300, parentVisitId: 'b' }),
    visit('d', { startedAt: 400, parentVisitId: 'a' }),
  ]);
  await db.queries.put({ id: 'q-b', visitId: 'b', engine: 'google', q: 'gardening soil', at: 200, expeditionId: 'e1' });
}

test('splitting at a Visit moves it and its descendants to a new Expedition and logs both states', async () => {
  await seedTrail();
  const newId = await corrections().split('b');

  const split = (await db.expeditions.get(newId!))!;
  expect(split).toMatchObject({ title: 'gardening soil', rootVisitId: 'b', startedAt: 200, endedAt: null, kind: 'learning' });
  const membership = Object.fromEntries((await db.visits.toArray()).map((v) => [v.id, v.expeditionId]));
  expect(membership).toEqual({ a: 'e1', b: newId, c: newId, d: 'e1' });
  expect((await db.queries.get('q-b'))?.expeditionId).toBe(newId);
  expect((await db.expeditions.get('e1'))?.centroid).not.toBeNull();
  expect(split.centroid).not.toBeNull();
  const [entry] = await db.corrections.toArray();
  expect(entry).toMatchObject({
    kind: 'split',
    before: { visits: { b: 'e1', c: 'e1' } },
    after: { visits: { b: newId, c: newId }, expeditionId: newId, fromExpeditionId: 'e1' },
  });
});

test('splitting at an Expedition root or an unassigned Visit changes nothing', async () => {
  await seedTrail();
  await db.visits.put(visit('loose', { expeditionId: null }));
  expect(await corrections().split('a')).toBeNull();
  expect(await corrections().split('loose')).toBeNull();
  expect(await db.expeditions.count()).toBe(1);
  expect(await db.corrections.count()).toBe(0);
});

test('merging moves every Visit, Query and Note into the target, drops the source and logs it', async () => {
  await seedTrail();
  await db.expeditions.put(expedition('e2', { rootVisitId: 'x', startedAt: 50, endedAt: 900 }));
  await db.visits.put(visit('x', { expeditionId: 'e2', startedAt: 50, expeditionEmbedding: Int8Array.of(50, 50) }));
  await db.notes.put({ id: 'n', nodeId: 'e2', text: 'about this trip', at: 1 });

  await corrections().merge('e1', 'e2');

  expect(await db.expeditions.get('e2')).toBeUndefined();
  expect((await db.visits.get('x'))?.expeditionId).toBe('e1');
  expect(await db.expeditions.get('e1')).toMatchObject({ title: 'CRDTs', startedAt: 50, rootVisitId: 'x', endedAt: null });
  expect((await db.expeditions.get('e1'))?.centroid).not.toBeNull();
  expect((await db.notes.get('n'))?.nodeId).toBe('e1');
  expect((await db.corrections.toArray())[0]).toMatchObject({
    kind: 'merge', before: { visits: { x: 'e2' }, intoId: 'e1', fromId: 'e2' }, after: { visits: { x: 'e1' } },
  });
});

test('moving a Visit changes only its Expedition and its Query; an emptied Expedition goes away', async () => {
  await seedTrail();
  await db.expeditions.put(expedition('e2', { rootVisitId: 'x' }));
  await db.visits.put(visit('x', { expeditionId: 'e2' }));

  await corrections().move('b', 'e2');
  expect(Object.fromEntries((await db.visits.toArray()).map((v) => [v.id, v.expeditionId]))).toEqual({
    a: 'e1', b: 'e2', c: 'e1', d: 'e1', x: 'e2',
  });
  expect((await db.queries.get('q-b'))?.expeditionId).toBe('e2');

  await corrections().move('x', 'e1');
  expect((await db.expeditions.get('e2'))?.rootVisitId).toBe('b');
  await corrections().move('b', 'e1');
  expect(await db.expeditions.get('e2')).toBeUndefined();
  expect((await db.corrections.toArray()).map(({ kind }) => kind)).toEqual(['move', 'move', 'move']);
});

test('moving the root Visit of an Expedition hands its root to the earliest remaining Visit', async () => {
  await seedTrail();
  await db.expeditions.put(expedition('e2', { rootVisitId: 'x' }));
  await db.visits.put(visit('x', { expeditionId: 'e2' }));
  await corrections().move('a', 'e2');
  expect((await db.expeditions.get('e1'))?.rootVisitId).toBe('b');
});
