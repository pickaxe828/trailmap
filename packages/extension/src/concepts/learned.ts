import type { Expedition } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { quantize } from '../embeddings/embedder';
import { putObservedEdge } from './edges';
import { forgetEdgeEvidence } from './forget';
import { conceptNameKey, notesEdgeSupport, refreshConcept, type ConceptEvidence } from './evidence';
import { matchConcept } from './match';

export type LearnedMention = {
  name: string; kind: ConceptEvidence['kind']; gloss: string;
  /** The stop the note is attached to, or the Expedition's own id for My notes. */
  anchorId: string;
  vector: Float32Array;
};
export type LearnedRelation = { from: string; to: string; type: import('@trailmap/shared').EdgeType };

/** Call inside a write transaction over conceptEvidence, concepts and edges. */
export async function removeLearnedEvidence(db: TrailmapDb, expeditionId: string, onlyAnchors?: ReadonlySet<string>) {
  const old = await db.conceptEvidence.where('expeditionId').equals(expeditionId)
    .filter((row) => row.role === 'learned' && (!onlyAnchors || onlyAnchors.has(row.visitId))).toArray();
  if (!old.length) return 0;
  await db.conceptEvidence.bulkDelete(old.map(({ id }) => id));
  // Relations are written for the whole set of notes together, so they are rebuilt together.
  const support = notesEdgeSupport(expeditionId);
  await forgetEdgeEvidence(db, new Set(), new Set(), new Set([support]));
  for (const id of new Set(old.map(({ conceptId }) => conceptId))) await refreshConcept(db, id);
  return old.length;
}

/**
 * Replaces everything this Expedition's notes taught with a fresh set of Concepts. Evidence points at the stop a
 * note is attached to, or at the Expedition for My notes, so Forget and the provenance rules apply as usual.
 */
export async function replaceLearnedEvidence(db: TrailmapDb, expedition: Pick<Expedition, 'id' | 'startedAt'>,
  mentions: LearnedMention[], relations: LearnedRelation[] = []) {
  await removeLearnedEvidence(db, expedition.id);
  const known = await db.concepts.toArray();
  const byName = new Map(known.flatMap((c) => [c.name, ...c.aliases].map((name) => [conceptNameKey(name), c.id] as const)));
  const candidates = new Map(known.map((c) => [c.id, c.embedding]));
  const onNotes = new Map<string, string>();
  const touched = new Set<string>();
  for (const mention of mentions) {
    const key = conceptNameKey(mention.name);
    const conceptId = onNotes.get(key) ?? matchConcept(key, mention.vector, byName, candidates).conceptId ?? crypto.randomUUID();
    byName.set(key, conceptId);
    onNotes.set(key, conceptId);
    const embedding = quantize(mention.vector);
    if (!candidates.has(conceptId)) candidates.set(conceptId, embedding);
    touched.add(conceptId);
    await db.conceptEvidence.add({
      id: crypto.randomUUID(), conceptId, role: 'learned', salience: 'central', name: mention.name, kind: mention.kind, gloss: mention.gloss,
      visitId: mention.anchorId, expeditionId: expedition.id, canonicalUrl: '', startedAt: expedition.startedAt, embedding,
    });
  }
  for (const id of touched) await refreshConcept(db, id);
  for (const { from, to, type } of relations) {
    const source = onNotes.get(conceptNameKey(from));
    const target = onNotes.get(conceptNameKey(to));
    if (source && target) await putObservedEdge(db, source, target, type, notesEdgeSupport(expedition.id));
  }
}
