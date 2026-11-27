import type { Concept } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { evidenceKey, evidenceStrength } from './strength';
import { loadStrengthContext } from './strength-read';

/** "I didn't learn this" (PLAN §4.5). Evidence stays; only what was already learned is remembered, by {@link evidenceKey}. */
export type ConceptDismissal = { conceptId: string; at: number; evidenceKeys: string[] };

export function dismissConcept(db: TrailmapDb, conceptId: string, at: number) {
  return db.transaction('rw', [db.dismissedConcepts, db.conceptEvidence, db.visits, db.highlights], async () => {
    const rows = await db.conceptEvidence.where('conceptId').equals(conceptId).toArray();
    const context = await loadStrengthContext(db, rows);
    const keys = new Set((await db.dismissedConcepts.get(conceptId))?.evidenceKeys);
    for (const row of rows) if (evidenceStrength(row, context) === 'learned') keys.add(evidenceKey(row));
    await db.dismissedConcepts.put({ conceptId, at, evidenceKeys: [...keys] });
  });
}

export const restoreConcept = (db: TrailmapDb, conceptId: string) => db.dismissedConcepts.delete(conceptId);

/** The concepts the user said they did not learn, for Settings. */
export async function readDismissedConcepts(db: TrailmapDb): Promise<Concept[]> {
  const rows = await db.dismissedConcepts.orderBy('at').toArray();
  const concepts = await db.concepts.bulkGet(rows.map(({ conceptId }) => conceptId));
  return concepts.filter((concept) => concept !== undefined);
}
