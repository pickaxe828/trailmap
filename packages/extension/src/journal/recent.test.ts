import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition } from '@trailmap/shared';
import { createCorrections } from '../corrections/corrections';
import { openTrailmapDb } from '../db/db';
import { createJournalCorrections } from './corrections';
import { readRecentChanges, undoRefusal } from './recent';

let clock = 10_000;
let name: string;
let db: ReturnType<typeof openTrailmapDb>;
let correct: ReturnType<typeof createJournalCorrections>;
const options = () => ({ db, now: () => clock++, newId: () => crypto.randomUUID() });
beforeEach(() => {
  clock = 10_000;
  name = crypto.randomUUID();
  db = openTrailmapDb(name);
  correct = createJournalCorrections(options());
});
afterEach(() => db.delete());
const expedition = (id: string, extra: Partial<Expedition> = {}): Expedition => ({
  id, title: id, startedAt: 0, endedAt: 1, kind: 'learning', threadId: null,
  fieldNotes: null, userEdited: false, drivingQuestion: null, ...extra,
});
const seedVisits = () => db.visits.bulkPut(['a', 'b'].map((id) => ({ id: `v-${id}`, title: id, url: `https://${id}.test/`,
  canonicalUrl: `https://${id}.test/`, tabId: 1, parentVisitId: null, transition: 'typed' as const, startedAt: 0, activeMs: 1,
  scrollDepth: 0, engagement: 'skimmed' as const, expeditionId: id })));

test('Recent changes list organise actions from the log, newest first, and survive reopening the database', async () => {
  await db.expeditions.bulkPut([expedition('a', { title: 'Vector clocks' }), expedition('b', { title: 'Delete markers' })]);
  await seedVisits();
  await correct({ action: 'classify', kind: 'errand', expeditionIds: ['a'] });
  await correct({ action: 'merge', intoId: 'a', fromIds: ['b'] });
  db.close();
  db = openTrailmapDb(name);
  const recent = await readRecentChanges(db);
  expect(recent.map(({ label }) => label)).toEqual([
    'Merged “Vector clocks” and “Delete markers”', 'Marked “Vector clocks” as not learning']);
});

test('an undone change leaves Recent changes, and undo entries never appear', async () => {
  await db.expeditions.bulkPut([expedition('a')]);
  const id = await correct({ action: 'classify', kind: 'errand', expeditionIds: ['a'] });
  expect(await readRecentChanges(db)).toHaveLength(1);
  await correct({ action: 'undo', correctionId: id! });
  expect(await readRecentChanges(db)).toEqual([]);
});

test('Recent changes keep only the latest 20', async () => {
  await db.expeditions.put(expedition('a'));
  for (let index = 0; index < 22; index++) await correct({ action: 'classify', kind: index % 2 ? 'learning' : 'errand', expeditionIds: ['a'] });
  const recent = await readRecentChanges(db);
  expect(recent).toHaveLength(20);
  expect(recent[0]!.at).toBeGreaterThan(recent[19]!.at);
});

test('a merge can be undone after reloading, restoring both expeditions', async () => {
  await db.expeditions.bulkPut([expedition('a', { startedAt: 0 }), expedition('b', { startedAt: 5 })]);
  await seedVisits();
  const id = await correct({ action: 'merge', intoId: 'a', fromIds: ['b'] });
  expect(await db.expeditions.get('b')).toBeUndefined();
  db.close();
  db = openTrailmapDb(name);
  correct = createJournalCorrections(options());
  const [entry] = await readRecentChanges(db);
  expect(entry!.id).toBe(id!);
  expect(await correct({ action: 'undo', correctionId: entry!.id })).toBeTruthy();
  expect(await db.expeditions.get('b')).toBeTruthy();
  expect((await db.visits.get('v-b'))?.expeditionId).toBe('b');
});

test('undo is refused as a conflict when a later change touched the same expedition', async () => {
  await db.expeditions.put(expedition('a'));
  const first = await correct({ action: 'classify', kind: 'errand', expeditionIds: ['a'] });
  await correct({ action: 'classify', kind: 'learning', expeditionIds: ['a'] });
  expect(await correct({ action: 'undo', correctionId: first! })).toBeNull();
  expect(await undoRefusal(db, first!)).toBe('conflict');
  expect((await db.expeditions.get('a'))?.kind).toBe('learning');
});

test('undo never brings back forgotten data and says it was forgotten', async () => {
  const url = 'https://forgettable.test/article';
  await db.visits.put({ id: 'source', title: 'Source', url, canonicalUrl: url, tabId: 1, parentVisitId: null,
    transition: 'typed', startedAt: 0, activeMs: 65_000, scrollDepth: 1, engagement: 'read', expeditionId: null });
  await db.expeditions.put(expedition('a', { title: 'Private title', fieldNotes: 'Private copied text', notesSource: { visitIds: ['source'], canonicalUrls: [url] } }));
  const id = await correct({ action: 'classify', kind: 'errand', expeditionIds: ['a'] });
  expect(await readRecentChanges(db)).toHaveLength(1);
  await createCorrections(options()).forgetSite('forgettable.test');
  expect(await readRecentChanges(db)).toEqual([]);
  expect(await correct({ action: 'undo', correctionId: id! })).toBeNull();
  expect(await undoRefusal(db, id!)).toBe('forgotten');
  expect(JSON.stringify(await db.corrections.toArray())).not.toContain('Private');
  expect((await db.expeditions.get('a'))?.fieldNotes).toBeNull();
});

test('an already undone change is reported as undone', async () => {
  await db.expeditions.put(expedition('a'));
  const id = await correct({ action: 'classify', kind: 'errand', expeditionIds: ['a'] });
  await correct({ action: 'undo', correctionId: id! });
  expect(await undoRefusal(db, id!)).toBe('undone');
});
