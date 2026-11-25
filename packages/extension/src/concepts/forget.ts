import type { TrailmapDb } from '../db/db';
import { refreshConcept } from './evidence';
import { edgeSupport, withEdgeSupport } from './edges';
import { enqueueMergeVerdicts } from './verdicts';

/** Runs inside Forget's transaction, so an in-flight verdict cannot put forgotten evidence back. */
export async function forgetConceptEvidence(db: TrailmapDb, gone: Set<string>, orphanUrls: string[], now: number) {
  const ids = [...gone];
  const rows = new Map((await Promise.all([
    db.conceptEvidence.where('visitId').anyOf(ids).toArray(),
    db.conceptEvidence.where('sourceVisitId').anyOf(ids).toArray(),
    db.conceptEvidence.where('canonicalUrl').anyOf(orphanUrls).toArray(),
  ])).flat().map((row) => [row.id, row]));
  await db.conceptEvidence.bulkDelete([...rows.keys()]);
  const removedConceptIds: string[] = [];
  for (const id of new Set([...rows.values()].map((row) => row.conceptId))) {
    if (!await refreshConcept(db, id)) removedConceptIds.push(id);
  }
  let removedJobs = 0;
  if (rows.size) {
    for (const job of await db.jobs.filter(({ payload }) => 'pairs' in payload && payload.pairs.some(({ candidateId, existingId }) =>
      rows.has(candidateId) || rows.has(existingId))).toArray()) {
      if (!('pairs' in job.payload)) continue;
      await db.jobs.delete(job.id);
      removedJobs++;
      if (job.status === 'pending' || job.status === 'leased') {
        await enqueueMergeVerdicts(db, job.payload.pairs.filter(({ candidateId, existingId }) => !rows.has(candidateId) && !rows.has(existingId)), now);
      }
    }
  }
  return {
    removedConceptIds, removedJobs,
    evidenceVisits: new Set([...gone, ...[...rows.values()].map((row) => row.visitId)]),
  };
}

export async function forgetEdgeEvidence(db: TrailmapDb, nodeIds: Set<string>, gone: Set<string>, evidenceVisits: Set<string>) {
  let touched = 0;
  for (const edge of await db.edges.toArray()) {
    if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
      await db.edges.delete(edge.id);
      touched++;
      continue;
    }
    const { observed, verdicts } = edgeSupport(edge);
    const trail = edge.type === 'navigated_from' || edge.type === 'searched' || edge.type === 'opened_in_new_tab';
    const removed = trail ? gone : evidenceVisits;
    const retainedObserved = observed.filter((id) => !removed.has(id));
    const retainedVerdicts = verdicts.filter((ids) => !ids.some((id) => removed.has(id)));
    if (retainedObserved.length === observed.length && retainedVerdicts.length === verdicts.length) continue;
    const revised = withEdgeSupport(edge, retainedObserved, retainedVerdicts);
    if (revised.evidence.length) await db.edges.put(revised);
    else await db.edges.delete(edge.id);
    touched++;
  }
  return touched;
}
