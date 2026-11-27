import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Page, Visit } from '@trailmap/shared';
import Dexie from 'dexie';
import { openTrailmapDb, type TrailmapDb } from './db';

let db: TrailmapDb;
let dbName: string;

beforeEach(() => {
  dbName = `trailmap-test-${crypto.randomUUID()}`;
  db = openTrailmapDb(dbName);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

const visit: Visit = {
  id: 'visit-1',
  url: 'http://learn.test/crdt',
  canonicalUrl: 'http://learn.test/crdt',
  title: 'CRDTs explained',
  tabId: 7,
  parentVisitId: null,
  transition: 'search',
  startedAt: 1_700_000_000_000,
  activeMs: 74_000,
  scrollDepth: 0.8,
  engagement: 'read',
  expeditionId: 'exp-1',
};

describe('database', () => {
  test('a Visit written to the database reads back unchanged', async () => {
    await db.visits.put(visit);
    expect(await db.visits.get('visit-1')).toEqual(visit);
  });

  test('Visits can be looked up by Expedition', async () => {
    await db.visits.bulkPut([
      visit,
      { ...visit, id: 'visit-2', expeditionId: 'exp-2' },
    ]);
    const inExp1 = await db.visits.where('expeditionId').equals('exp-1').toArray();
    expect(inExp1.map((v) => v.id)).toEqual(['visit-1']);
  });

  test('a Visit written by a non-recorder path also strips browser session credentials', async () => {
    const url = 'https://kagi.com/search?q=crdts&token=private-history-fixture';
    await db.visits.add({ ...visit, id: 'history:7', url, canonicalUrl: 'https://kagi.com/search?q=crdts' });
    expect((await db.visits.get('history:7'))?.url).toBe('https://kagi.com/search?q=crdts');
  });

  test('upgrade queues resolution for previously enriched Pages with evidence without calling a model', async () => {
    const previous = new Dexie(dbName);
    previous.version(5).stores({ pages: 'canonicalUrl, textHash, enrichedAt', jobs: 'id, status, [status+priority+createdAt]' });
    await previous.table('pages').add({
      canonicalUrl: visit.canonicalUrl, text: 'Page text', textHash: 'hash', summary: 'Summary', takeaways: [],
      embedding: null, pageKind: 'article', enrichedAt: 2000, enrichmentVisitId: visit.id,
      conceptMentions: [{ name: 'CRDT', gloss: 'A replicated data type', role: 'explains', kind: 'concept' }],
    } satisfies Page);
    previous.close();
    expect(await db.jobs.toArray()).toMatchObject([
      { kind: 'concept_resolution', status: 'pending', payload: { canonicalUrl: visit.canonicalUrl, visitId: visit.id, enrichedAt: 2000 } },
    ]);
  });

  test('upgrading a v7 database removes persisted session tokens without losing an unrelated store', async () => {
    const previous = new Dexie(dbName);
    previous.version(7).stores({ visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId, [segmentationPending+startedAt]', notes: 'id, nodeId, at' });
    const stale = 'https://kagi.com/search?q=crdts&token=old-fixture-secret';
    await previous.table('visits').add({ ...visit, url: stale, canonicalUrl: 'https://kagi.com/search?q=crdts' });
    await previous.table('notes').add({ id: 'note', nodeId: visit.id, text: 'Keep this', at: 1 });
    previous.close();
    expect((await db.visits.get(visit.id))?.url).toBe('https://kagi.com/search?q=crdts');
    expect((await db.notes.get('note'))?.text).toBe('Keep this');
  });

  test('upgrade moves user-edited field notes into My notes and queues regenerated field notes', async () => {
    const previous = new Dexie(dbName);
    previous.version(9).stores({ expeditions: 'id, startedAt, endedAt, threadId, kind, unseenNotes', corrections: 'id, at, *targetIds',
      jobs: 'id, status, [status+priority+createdAt]' });
    const base = { kind: 'learning', startedAt: 1, endedAt: 9, drivingQuestion: null, threadId: null, wrappedUpAt: 5 };
    await previous.table('expeditions').bulkAdd([
      { ...base, id: 'edited', title: 'Edited', fieldNotes: 'My own words', userEdited: true },
      { ...base, id: 'renamed', title: 'Renamed', fieldNotes: 'Generated', userEdited: true },
      { ...base, id: 'plain', title: 'Plain', fieldNotes: 'Generated too', userEdited: false },
    ]);
    await previous.table('corrections').add({ id: 'c1', at: 2, kind: 'field-notes', targetIds: ['edited'], before: null, after: null });
    previous.close();
    expect(await db.expeditions.get('edited')).toMatchObject({ myNotes: 'My own words', fieldNotes: null, userEdited: true });
    expect(await db.expeditions.get('renamed')).toMatchObject({ fieldNotes: 'Generated', userEdited: true });
    expect((await db.expeditions.get('renamed'))?.myNotes).toBeUndefined();
    expect((await db.expeditions.get('plain'))?.myNotes).toBeUndefined();
    expect(await db.jobs.toArray()).toMatchObject([{ kind: 'field_notes', status: 'pending', payload: { expeditionId: 'edited', endedAt: 9, revision: 1 } }]);
  });

  test('has tables for domain entities, durable jobs, model dispatches and the correction log', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'conceptEvidence', 'concepts', 'corrections', 'edges', 'expeditions', 'highlights', 'jobs', 'modelHealth', 'notes', 'pages', 'queries', 'queueHolds', 'sentToModel', 'threads', 'visits',
    ]);
  });
});
