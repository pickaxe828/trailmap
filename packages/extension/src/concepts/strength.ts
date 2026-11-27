import type { Visit } from '@trailmap/shared';
import { conceptNameKey, type ConceptEvidence } from './evidence';

/** PLAN §4.5: how much of a concept the user took in. Only `learned` and `studied` put a concept on the Atlas. */
export type EvidenceStrength = 'learned' | 'studied' | 'seen';

type StrengthRow = Pick<ConceptEvidence, 'role' | 'salience' | 'name' | 'visitId' | 'canonicalUrl' | 'expeditionId'>;
type StrengthVisit = Pick<Visit, 'engagement'> & Partial<Pick<Visit, 'starred'>>;
/** What the strength of evidence depends on besides the row itself: current engagement, stars and highlight text. */
export type StrengthContext = { visits: ReadonlyMap<string, StrengthVisit>; highlights: ReadonlyMap<string, readonly string[]> };
/** Evidence that was learned when the user said "I didn't learn this", by {@link evidenceKey}. */
export type Dismissal = { evidenceKeys: readonly string[] };

const rank: Record<EvidenceStrength, number> = { seen: 0, studied: 1, learned: 2 };

/** One unit of learning: a Page, or one Expedition's notes. It survives a notes pass that replaces the row ids. */
export const evidenceKey = (row: Pick<ConceptEvidence, 'role' | 'visitId' | 'canonicalUrl' | 'expeditionId'>) =>
  row.role === 'learned' ? `notes:${row.expeditionId ?? ''}:${row.visitId}` : row.canonicalUrl;

export function evidenceStrength(row: StrengthRow, { visits, highlights }: StrengthContext): EvidenceStrength {
  if (row.role === 'learned') return 'learned';
  const visit = visits.get(row.visitId);
  if (!visit) return 'seen';
  const key = conceptNameKey(row.name);
  if (key && (highlights.get(row.visitId) ?? []).some((text) => conceptNameKey(text).includes(key))) return 'learned';
  if (visit.starred && row.salience === 'central') return 'learned';
  if (visit.engagement === 'read' && row.salience !== 'passing') return 'studied';
  return 'seen';
}

export function summarizeStrength(rows: readonly (StrengthRow & { id?: string })[], context: StrengthContext, dismissal?: Dismissal) {
  const known = new Set(dismissal?.evidenceKeys);
  const units = new Set<string>();
  let strength: EvidenceStrength = 'seen';
  for (const row of rows) {
    let own = evidenceStrength(row, context);
    // After "I didn't learn this", only learning the user has not already dismissed counts.
    if (dismissal && (own === 'studied' || known.has(evidenceKey(row)))) own = 'seen';
    if (own === 'seen') continue;
    units.add(evidenceKey(row));
    if (rank[own] > rank[strength]) strength = own;
  }
  return { strength, exposure: units.size, dismissed: !!dismissal && strength === 'seen' };
}
