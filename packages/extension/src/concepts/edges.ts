import type { Edge, EdgeType } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';

export const edgeSupport = (edge: Edge) => ({
  observed: edge.observedEvidence ?? edge.evidence,
  verdicts: edge.verdictEvidence ?? [],
});

/** Observations are independent; each verdict needs its entire set of source Visits. */
export function withEdgeSupport(edge: Pick<Edge, 'id' | 'from' | 'to' | 'type'>, observed: string[], verdicts: string[][]): Edge {
  const evidence = [...new Set([...observed, ...verdicts.flat()])].sort();
  return {
    id: edge.id, from: edge.from, to: edge.to, type: edge.type, evidence, weight: evidence.length,
    ...(verdicts.length ? { observedEvidence: [...new Set(observed)].sort(), verdictEvidence: verdicts } : {}),
  };
}

type Support = ReturnType<typeof edgeSupport>;
export async function putConceptEdge(db: TrailmapDb, from: string, to: string, type: EdgeType, support: Support) {
  if (from === to) return;
  const id = JSON.stringify([from, type, to]);
  const current = await db.edges.get(id);
  const previous = current ? edgeSupport(current) : { observed: [], verdicts: [] };
  const bySources = new Map([...previous.verdicts, ...support.verdicts].map((visits) => {
    const sources = [...new Set(visits)].sort();
    return [JSON.stringify(sources), sources] as const;
  }));
  await db.edges.put(withEdgeSupport({ id, from, to, type }, [...previous.observed, ...support.observed], [...bySources.values()]));
}

export const putObservedEdge = (db: TrailmapDb, from: string, to: string, type: EdgeType, visitId: string) =>
  putConceptEdge(db, from, to, type, { observed: [visitId], verdicts: [] });
