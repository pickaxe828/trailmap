import type { TrailmapDb } from '../db/db';
import { refreshExpeditionCentroid } from '../segmentation/expedition-recorder';

/**
 * Brings an Expedition back in line with its Visits after members were moved or
 * deleted: removes it (and its Notes) when empty, otherwise gives it a root that
 * is still a member and rebuilds its centroid. Call inside a transaction over
 * visits, queries, expeditions and notes.
 */
export async function repairExpedition(db: TrailmapDb, expeditionId: string, { derivedContentRemoved = false } = {}) {
  const expedition = await db.expeditions.get(expeditionId);
  if (!expedition) return;
  const members = await db.visits.where('expeditionId').equals(expeditionId).sortBy('startedAt');
  if (!members.length) {
    await db.expeditions.delete(expeditionId);
    await db.notes.where('nodeId').equals(expeditionId).delete();
    return;
  }
  const changes: Partial<typeof expedition> = {};
  if (!members.some(({ id }) => id === expedition.rootVisitId)) {
    const root = members[0]!;
    changes.rootVisitId = root.id;
    if (!expedition.userEdited) {
      const query = await db.queries.where('visitId').equals(root.id).first();
      changes.title = query?.q.trim() || root.title.trim() || URL.parse(root.canonicalUrl)?.hostname || 'Untitled page';
    }
  }
  // Model-written fields were derived from content that is gone. The user's own edits stay.
  if (derivedContentRemoved && !expedition.userEdited) {
    changes.fieldNotes = null;
    changes.drivingQuestion = null;
  }
  if (members[0]!.startedAt !== expedition.startedAt) changes.startedAt = members[0]!.startedAt;
  if (Object.keys(changes).length) await db.expeditions.update(expeditionId, changes);
  await refreshExpeditionCentroid(db, expeditionId);
}
