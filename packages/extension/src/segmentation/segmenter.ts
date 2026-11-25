import type { Expedition, Visit } from '@trailmap/shared';
import { cosine, type Embedder, quantize } from '../embeddings/embedder';

import { EXPEDITION_WINDOW_MS, ROOT_SIMILARITY } from "./config";

type Input = {
  visit: Visit;
  query?: string;
  parent?: Expedition;
  candidates: Expedition[];
  embedder: Embedder;
};

export async function segmentVisit({ visit, query, parent, candidates, embedder }: Input) {
  const text = query?.trim() || visit.title.trim();
  const embedding = text ? await embedText(embedder, text) : undefined;
  if (parent?.endedAt === null) return { expeditionId: parent.id, embedding };

  let expeditionId: string | null = null;
  let bestScore = ROOT_SIMILARITY;
  if (embedding) {
    for (const candidate of candidates) {
      if (candidate.endedAt !== null || !candidate.centroid ||
          candidate.startedAt < visit.startedAt - EXPEDITION_WINDOW_MS ||
          candidate.startedAt > visit.startedAt) continue;
      const score = cosine(embedding, candidate.centroid);
      if (score >= bestScore && (expeditionId === null || score > bestScore)) {
        bestScore = score;
        expeditionId = candidate.id;
      }
    }
  }
  return { expeditionId, embedding };
}

async function embedText(embedder: Embedder, text: string): Promise<Int8Array<ArrayBuffer> | null> {
  try {
    const [vector] = await embedder.embed([text]);
    return vector ? quantize(vector) : null;
  } catch {
    return null;
  }
}
