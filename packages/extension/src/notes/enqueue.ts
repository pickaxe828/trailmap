import type { TrailmapDb } from '../db/db';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue';
import { removeLearnedEvidence } from '../concepts/learned';
import { collectMyNotes, type NotesSources } from './input';

/** Writing is bursty: wait for a pause before asking a model about the notes. */
export const NOTES_DEBOUNCE_MS = 60_000;

export async function readNotesSources(db: TrailmapDb, expeditionId: string): Promise<NotesSources | undefined> {
  const expedition = await db.expeditions.get(expeditionId);
  if (!expedition) return;
  const [visits, queries] = await Promise.all([
    db.visits.where('expeditionId').equals(expeditionId).toArray(),
    db.queries.where('expeditionId').equals(expeditionId).toArray(),
  ]);
  const notes = await db.notes.where('nodeId').anyOf([...visits.map(({ id }) => id), ...queries.map(({ id }) => id)]).toArray();
  return { expedition, visits, queries, notes };
}

/**
 * Call inside a write transaction over expeditions, visits, queries, notes, jobs, conceptEvidence, concepts and edges
 * after My notes or a stop note changed. A newer pass replaces a waiting one; with nothing written, what the notes
 * taught is removed straight away.
 */
export async function enqueueNotesEnrichment(db: TrailmapDb, expeditionId: string, now: number, delayMs = NOTES_DEBOUNCE_MS) {
  const sources = await readNotesSources(db, expeditionId);
  await db.jobs.filter(({ kind, status, payload }) => kind === 'notes_enrichment' && status === 'pending' &&
    'expeditionId' in payload && payload.expeditionId === expeditionId).delete();
  if (!sources) return;
  const { mine, stops } = collectMyNotes(sources);
  if (!mine && !stops.length) {
    await removeLearnedEvidence(db, expeditionId);
    return;
  }
  const revision = sources.expedition.myNotesAt ?? 0;
  const stamp = Math.max(revision, ...sources.notes.map(({ at }) => at));
  await enqueueJob(db, {
    kind: 'notes_enrichment', key: JSON.stringify([expeditionId, stamp, mine.length, stops.length]), priority: JOB_PRIORITY.fieldNotes,
    payload: { expeditionId, stamp }, delayMs,
  }, now);
}

/** The setting was switched back on: ask about every Expedition that has notes. */
export async function enqueueAllMyNotes(db: TrailmapDb, now: number) {
  const ids = new Set((await db.expeditions.filter(({ myNotes }) => !!myNotes?.trim()).primaryKeys()) as string[]);
  const stopIds = (await db.notes.toArray()).map(({ nodeId }) => nodeId);
  const stops = [...(await db.visits.bulkGet(stopIds)), ...(await db.queries.bulkGet(stopIds))];
  for (const stop of stops) if (stop?.expeditionId) ids.add(stop.expeditionId);
  for (const id of ids) {
    await db.transaction('rw', [db.expeditions, db.visits, db.queries, db.notes, db.jobs, db.conceptEvidence, db.concepts, db.edges],
      () => enqueueNotesEnrichment(db, id, now, 0));
  }
}
