import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Visit } from '@trailmap/shared';
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
  url: 'http://learn.test/crdt?utm_source=x',
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

  test('has tables for domain entities, durable jobs and model dispatches', () => {
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'concepts', 'edges', 'expeditions', 'highlights', 'jobs', 'notes', 'pages', 'queries', 'queueHolds', 'sentToModel', 'threads', 'visits',
    ]);
  });
});
