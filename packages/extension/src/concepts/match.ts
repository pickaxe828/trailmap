import { cosine } from '../embeddings/embedder';

/**
 * Picks the Concept a new mention belongs to. A name or alias match wins; otherwise the closest
 * stored embedding joins above 0.9, and falls in the uncertain band (0.8–0.9, inclusive) for a verdict.
 */
export function matchConcept(key: string, vector: Float32Array, byName: ReadonlyMap<string, string>,
  candidates: ReadonlyMap<string, Int8Array | null>): { conceptId?: string; uncertain?: string } {
  const named = byName.get(key);
  if (named) return { conceptId: named };
  let best = -Infinity;
  let closest: string | undefined;
  for (const [id, embedding] of candidates) {
    const score = embedding ? cosine(vector, embedding) : 0;
    if (score > best) { best = score; closest = id; }
  }
  if (best > 0.9) return { conceptId: closest };
  return best >= 0.8 ? { uncertain: closest } : {};
}
