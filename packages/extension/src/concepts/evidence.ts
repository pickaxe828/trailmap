import type { Concept, Page, Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';

/** Retain the actual mention, not just the winning Concept's display text, so Forget can rebuild it. */
export type ConceptEvidence = Omit<NonNullable<Page['conceptMentions']>[number], 'role'> & {
  /** `learned` comes from the user's own notes (PLAN §4.5a), not from a Page. */
  role: NonNullable<Page['conceptMentions']>[number]['role'] | 'learned';
  /** Set on `learned` rows. `visitId` is then the stop the note is attached to, or this id for the Expedition's My notes. */
  expeditionId?: string;
  id: string;
  conceptId: string;
  visitId: string;
  canonicalUrl: string;
  sourceUrl?: string;
  sourceVisitId?: string;
  enrichmentSources?: Page['enrichmentSources'];
  startedAt: number;
  embedding: Concept['embedding'];
};

export const conceptNameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const stoplist = new Set(['computer science', 'software']);
/** What an Expedition's My notes (and the notes on its stops) say, as a learned-evidence anchor and an Edge support id. */
export const notesEdgeSupport = (expeditionId: string) => `notes:${expeditionId}`;
export const isConceptName = (key: string) => !!key && !stoplist.has(key);

export function summarizeConcept(id: string, evidence: ConceptEvidence[]): Concept | undefined {
  const ordered = [...evidence].sort((a, b) => a.startedAt - b.startedAt || a.visitId.localeCompare(b.visitId) ||
    conceptNameKey(a.name).localeCompare(conceptNameKey(b.name)));
  const first = ordered[0];
  if (!first) return;
  const aliases = new Map<string, string>([[conceptNameKey(first.name), first.name]]);
  for (const row of ordered) {
    const key = conceptNameKey(row.name);
    if (!aliases.has(key)) aliases.set(key, row.name);
  }
  return {
    id, name: first.name, aliases: [...aliases.values()].slice(1), kind: first.kind, gloss: first.gloss,
    embedding: first.embedding, firstSeen: first.startedAt, exposure: new Set(evidence.filter((row) => row.role !== 'learned').map((row) => row.canonicalUrl)).size,
  };
}

export async function refreshConcept(db: TrailmapDb, id: string): Promise<boolean> {
  const concept = summarizeConcept(id, await db.conceptEvidence.where('conceptId').equals(id).toArray());
  if (concept) await db.concepts.put(concept);
  else await db.concepts.delete(id);
  return !!concept;
}

export type ConceptEvidencePage = {
  page: Page;
  visits: { visit: Visit; roles: ConceptEvidence['role'][] }[];
};
