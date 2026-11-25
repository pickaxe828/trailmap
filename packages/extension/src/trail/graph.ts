import type { Query, Visit } from '@trailmap/shared';

export type TrailGraphNode =
  | { id: string; kind: 'page'; visit: Visit }
  | { id: string; kind: 'question'; visit: Visit | null; query: Query };

export type TrailGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'navigated_from' | 'opened_in_new_tab';
};

export type TrailGraph = { nodes: TrailGraphNode[]; edges: TrailGraphEdge[] };

/** One card per Visit, even when several Visits have the same canonical URL. */
export function buildTrailGraph(visits: readonly Visit[], queries: readonly Query[]): TrailGraph {
  const ordered = [...visits].sort((a, b) => a.startedAt - b.startedAt);
  const ids = new Set(ordered.map(({ id }) => id));
  const queriesByVisit = new Map<string, Query>();
  const nodes: TrailGraphNode[] = [];
  for (const query of queries) {
    if (query.visitId === undefined) {
      nodes.push({ id: `query:${query.id}`, kind: 'question', visit: null, query });
    } else {
      queriesByVisit.set(query.visitId, query);
    }
  }
  for (const visit of ordered) {
    const query = queriesByVisit.get(visit.id);
    nodes.push(query ? { id: visit.id, kind: 'question', visit, query } : { id: visit.id, kind: 'page', visit });
  }
  const edges: TrailGraphEdge[] = [];
  for (const { id, parentVisitId, transition } of ordered) {
    if (parentVisitId === null || parentVisitId === id || !ids.has(parentVisitId)) continue;
    edges.push({
      id: `lineage:${id}`,
      source: parentVisitId,
      target: id,
      kind: transition === 'new-tab' ? 'opened_in_new_tab' : 'navigated_from',
    });
  }
  return { nodes, edges };
}
