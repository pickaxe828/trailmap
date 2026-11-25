import Dexie, { type EntityTable } from 'dexie';
import type {
  Concept,
  Edge,
  Expedition,
  Highlight,
  Note,
  Page,
  Query,
  Thread,
  Visit,
} from '@trailmap/shared';

/**
 * The Trailmap IndexedDB database. One table per entity in docs/PLAN.md §3.
 *
 * Schema changes: never edit an existing `version(n)` block. Add a new
 * `version(n + 1)` with the full new stores (plus `.upgrade()` if data must be
 * migrated), so existing users' databases upgrade in place.
 */
export type TrailmapDb = Dexie & {
  visits: EntityTable<Visit, 'id'>;
  pages: EntityTable<Page, 'canonicalUrl'>;
  queries: EntityTable<Query, 'id'>;
  expeditions: EntityTable<Expedition, 'id'>;
  threads: EntityTable<Thread, 'id'>;
  concepts: EntityTable<Concept, 'id'>;
  edges: EntityTable<Edge, 'id'>;
  highlights: EntityTable<Highlight, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

export const DB_NAME = 'trailmap';

export function openTrailmapDb(name: string = DB_NAME): TrailmapDb {
  const db = new Dexie(name) as TrailmapDb;
  db.version(1).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at',
    expeditions: 'id, startedAt, endedAt, threadId, kind',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at',
    notes: 'id, nodeId, at',
  });
  db.version(2).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at, visitId',
    expeditions: 'id, startedAt, endedAt, threadId, kind',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at, canonicalUrl',
    notes: 'id, nodeId, at',
  });
  return db;
}
