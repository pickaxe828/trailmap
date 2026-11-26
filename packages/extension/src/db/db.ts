import Dexie, { type EntityTable } from 'dexie';
import type {
  Concept,
  Edge,
  Expedition,
  Highlight,
  ModelDispatch,
  Note,
  Page,
  Query,
  Thread,
  Visit,
} from '@trailmap/shared';
import { canonicalizeUrl } from '../capture/canonical';
import type { ConceptEvidence } from '../concepts/evidence';
import { conceptResolutionJob } from '../concepts/enqueue';
import { enqueueJob } from '../jobs/queue';
import type { Job, JobSpec, QueueHold } from '../jobs/types';

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
  conceptEvidence: EntityTable<ConceptEvidence, 'id'>;
  edges: EntityTable<Edge, 'id'>;
  highlights: EntityTable<Highlight, 'id'>;
  notes: EntityTable<Note, 'id'>;
  jobs: EntityTable<Job, 'id'>;
  queueHolds: EntityTable<QueueHold, 'id'>;
  sentToModel: EntityTable<SentToModel, 'id'>;
  corrections: EntityTable<CorrectionLogEntry, 'id'>;
};

/** A user correction (docs/PLAN.md §4.3 rule 5). `targetIds` lets Forget remove entries that mention forgotten items. */
export type CorrectionLogEntry = {
  id: string;
  at: number;
  kind: string;
  targetIds: string[];
  before: unknown;
  after: unknown;
};

export type SentToModel = ModelDispatch & {
  id: string; at: number; task: string; canonicalUrl?: string; expeditionId?: string; canonicalUrls?: string[]; visitIds?: string[];
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
  db.version(3).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId, [segmentationPending+startedAt]',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at, visitId',
    expeditions: 'id, startedAt, endedAt, threadId, kind',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at, canonicalUrl',
    notes: 'id, nodeId, at',
  });
  db.version(4).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId, [segmentationPending+startedAt]',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at, visitId',
    expeditions: 'id, startedAt, endedAt, threadId, kind',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at, canonicalUrl',
    notes: 'id, nodeId, at',
    jobs: 'id, status, [status+priority+createdAt]',
    queueHolds: 'id',
    sentToModel: 'id, at, canonicalUrl',
  });
  db.version(5).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId, [segmentationPending+startedAt]',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at, visitId',
    expeditions: 'id, startedAt, endedAt, threadId, kind',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at, canonicalUrl',
    notes: 'id, nodeId, at',
    jobs: 'id, status, [status+priority+createdAt]',
    queueHolds: 'id',
    sentToModel: 'id, at, canonicalUrl',
    corrections: 'id, at, *targetIds',
  });
  db.version(6).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId, [segmentationPending+startedAt]',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at, visitId',
    expeditions: 'id, startedAt, endedAt, threadId, kind, unseenNotes',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at, canonicalUrl',
    notes: 'id, nodeId, at',
    jobs: 'id, status, [status+priority+createdAt]',
    queueHolds: 'id',
    sentToModel: 'id, at, canonicalUrl',
    corrections: 'id, at, *targetIds',
  });
  db.version(7).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId, [segmentationPending+startedAt]',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at, visitId',
    expeditions: 'id, startedAt, endedAt, threadId, kind, unseenNotes',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    conceptEvidence: 'id, conceptId, visitId, sourceVisitId, canonicalUrl',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at, canonicalUrl',
    notes: 'id, nodeId, at',
    jobs: 'id, status, [status+priority+createdAt]',
    queueHolds: 'id',
    sentToModel: 'id, at, canonicalUrl',
    corrections: 'id, at, *targetIds',
  }).upgrade(async () => {
    const jobs: JobSpec<'concept_resolution'>[] = [];
    await db.pages.where('enrichedAt').aboveOrEqual(0).each((page) => {
      const job = conceptResolutionJob(page);
      if (job) jobs.push(job);
    });
    for (const job of jobs) await enqueueJob(db, job, job.payload.enrichedAt);
  });
  db.version(8).stores({
    visits: 'id, canonicalUrl, tabId, parentVisitId, startedAt, expeditionId, [segmentationPending+startedAt], captureDocumentId',
    pages: 'canonicalUrl, textHash, enrichedAt',
    queries: 'id, expeditionId, at, visitId',
    expeditions: 'id, startedAt, endedAt, threadId, kind, unseenNotes',
    threads: 'id, lastActiveAt, status',
    concepts: 'id, name, *aliases, firstSeen',
    conceptEvidence: 'id, conceptId, visitId, sourceVisitId, canonicalUrl',
    edges: 'id, from, to, type, [from+type], [to+type]',
    highlights: 'id, visitId, at, canonicalUrl',
    notes: 'id, nodeId, at',
    jobs: 'id, status, [status+priority+createdAt]',
    queueHolds: 'id',
    sentToModel: 'id, at, canonicalUrl',
    corrections: 'id, at, *targetIds',
  }).upgrade(async () => {
    await db.visits.toCollection().modify((visit) => { visit.url = canonicalizeUrl(visit.url); });
    // Old generated Markdown embedded local-only unread links. Strip that historical format once,
    // before it can become a living-note input. Future writes keep unread stops in their own field.
    await db.expeditions.filter(({ notesSource }) => !!notesSource).modify((expedition) => {
      expedition.fieldNotes = expedition.fieldNotes?.split('\n').filter((line) => !line.startsWith('- Opened but never read: ')).join('\n') ?? null;
    });
    // Older split entries didn't index all moved descendants.
    await db.corrections.where('at').aboveOrEqual(0).and(({ kind }) => kind === 'split').modify((entry) => {
      const before = entry.before as { visits?: Record<string, string> } | null;
      entry.targetIds = [...new Set([...entry.targetIds, ...Object.keys(before?.visits ?? {})])];
    });
  });
  // History replay and any other Visit writer use the same persistence boundary.
  db.visits.hook('creating', (_id, visit) => { visit.url = canonicalizeUrl(visit.url); });
  db.visits.hook('updating', (changes) => {
    const { url } = changes as { url?: unknown };
    return typeof url === 'string' ? { url: canonicalizeUrl(url) } : undefined;
  });
  return db;
}
