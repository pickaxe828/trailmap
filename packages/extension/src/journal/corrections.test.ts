import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition } from '@trailmap/shared';
import { createCorrections } from '../corrections/corrections';
import { openTrailmapDb } from '../db/db';
import { createJournalCorrections } from './corrections';

const at = 10_000;
let db: ReturnType<typeof openTrailmapDb>;
let correct: ReturnType<typeof createJournalCorrections>;
beforeEach(() => {
  db = openTrailmapDb(crypto.randomUUID());
  correct = createJournalCorrections({ db, now: () => at, newId: () => crypto.randomUUID() });
});
afterEach(() => db.delete());
const expedition = (id: string, extra: Partial<Expedition> = {}): Expedition => ({
  id, title: id, startedAt: 0, endedAt: 1, kind: 'learning', threadId: null,
  fieldNotes: null, userEdited: false, drivingQuestion: null, ...extra,
});

test('marking a session not learning clears notes, detaches it, and can be undone', async () => {
  const threadId = 'thread';
  await db.threads.put({ id: threadId, title: 'Systems', status: 'active', question: null, lastActiveAt: 1,
    livingNote: null, centroid: null, conceptIds: [] });
  await db.expeditions.bulkPut([expedition('a', { threadId, fieldNotes: 'Useful notes', unseenNotes: 1 }), expedition('b', { threadId })]);
  const id = await correct({ action: 'classify', kind: 'errand', expeditionIds: ['a'] });
  expect(id).toBeTruthy();
  expect(await db.expeditions.get('a')).toMatchObject({ kind: 'errand', threadId: null, fieldNotes: null });
  expect((await db.expeditions.get('a'))?.unseenNotes).toBeUndefined();
  expect(await db.threads.get(threadId)).toBeUndefined();
  await correct({ action: 'undo', correctionId: id! });
  expect(await db.expeditions.get('a')).toMatchObject({ kind: 'learning', threadId, fieldNotes: 'Useful notes' });
  expect(await db.expeditions.get('b')).toMatchObject({ threadId });
});

test('marking an unclassified closed Expedition as learning queues field notes', async () => {
  await db.expeditions.put(expedition('a', { kind: 'unclassified' }));
  expect(await correct({ action: 'classify', kind: 'learning', expeditionIds: ['a'] })).toBeTruthy();
  expect(await db.expeditions.get('a')).toMatchObject({ kind: 'learning', kindOverride: true });
  expect(await db.jobs.toArray()).toMatchObject([{ kind: 'field_notes', payload: { expeditionId: 'a', endedAt: 1 } }]);
});

test('Forget removes any undo payload whose field notes used the forgotten source', async () => {
  const url = 'https://forgettable.test/article';
  await db.visits.put({ id: 'source', title: 'Source', url, canonicalUrl: url, tabId: 1, parentVisitId: null,
    transition: 'typed', startedAt: 0, activeMs: 65_000, scrollDepth: 1, engagement: 'read', expeditionId: null });
  await db.expeditions.put(expedition('a', { fieldNotes: 'Private copied text', notesSource: { visitIds: ['source'], canonicalUrls: [url] } }));
  const id = await correct({ action: 'classify', kind: 'errand', expeditionIds: ['a'] });
  expect(id).toBeTruthy();
  await createCorrections({ db, now: () => at + 1, newId: () => crypto.randomUUID() }).forgetSite('forgettable.test');
  expect(await correct({ action: 'undo', correctionId: id! })).toBeNull();
  expect(JSON.stringify(await db.corrections.toArray())).not.toContain('Private copied text');
});
