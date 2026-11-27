import type { TrailmapDb } from '../db/db';
import type { ConceptEvidence } from './evidence';
import type { StrengthContext } from './strength';

/** Call inside a read transaction over visits and highlights. Strength follows current engagement, not engagement at enrichment. */
export async function loadStrengthContext(db: TrailmapDb, rows: readonly Pick<ConceptEvidence, 'visitId' | 'role'>[]): Promise<StrengthContext> {
  const ids = [...new Set(rows.flatMap((row) => row.role === 'learned' ? [] : [row.visitId]))];
  const [visits, highlights] = await Promise.all([db.visits.bulkGet(ids), db.highlights.where('visitId').anyOf(ids).toArray()]);
  const text = new Map<string, string[]>();
  for (const { visitId, text: value } of highlights) text.set(visitId, [...text.get(visitId) ?? [], value]);
  return { visits: new Map(visits.flatMap((visit) => visit ? [[visit.id, visit] as const] : [])), highlights: text };
}
