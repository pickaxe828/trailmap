import type { Expedition } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue';

/**
 * Call inside the transaction that sets `endedAt` (with `db.jobs` in scope).
 * `revision` lets a later ticket ask for a fresh pass after a correction.
 */
export async function enqueueWrapUp(db: TrailmapDb, expedition: Expedition, now: number, revision = 0) {
  if (expedition.endedAt === null) return;
  await enqueueJob(db, {
    kind: 'expedition_wrap_up',
    key: JSON.stringify([expedition.id, expedition.endedAt, revision]),
    priority: JOB_PRIORITY.fieldNotes,
    payload: { expeditionId: expedition.id, endedAt: expedition.endedAt, revision },
  }, now);
}
