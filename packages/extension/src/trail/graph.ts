import type { Query, Visit } from '@trailmap/shared';

type TrailVisitNode =
  | { id: string; kind: 'page'; visit: Visit }
  | { id: string; kind: 'question'; visit: Visit | null; query: Query };

export type TrailGraphNode =
  | (TrailVisitNode & { emphasis?: 'full' | 'muted' })
  | { id: string; kind: 'skipped'; visits: Visit[]; emphasis: 'muted' };

export type TrailGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'navigated_from' | 'opened_in_new_tab';
  dashed?: boolean;
};

export type TrailGraph = { nodes: TrailGraphNode[]; edges: TrailGraphEdge[] };

/** One card per Visit, even when several Visits have the same canonical URL. */
export function buildTrailGraph(visits: readonly Visit[], queries: readonly Query[]): { nodes: TrailVisitNode[]; edges: TrailGraphEdge[] } {
  const ordered = [...visits].sort((a, b) => a.startedAt - b.startedAt);
  const ids = new Set(ordered.map(({ id }) => id));
  const queriesByVisit = new Map<string, Query>();
  const nodes: TrailVisitNode[] = [];
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

/** Collapse contiguous bounced Visits and bounced siblings, but never hide a search question. */
export function buildExpeditionTrail(visits: readonly Visit[], queries: readonly Query[]): TrailGraph {
  const raw = buildTrailGraph(visits, queries);
  const parents = new Map(raw.edges.map(({ source, target }) => [target, source]));
  const bounced = new Set(raw.nodes.flatMap((node) =>
    node.kind === 'page' && node.visit.engagement === 'bounced' ? [node.id] : []));
  const groups = new Map<string, string>();
  const skipped = new Map<string, Extract<TrailGraphNode, { kind: 'skipped' }>>();
  const nodes: TrailGraphNode[] = [];

  function groupOf(id: string): string {
    let current = id;
    const path = new Set<string>();
    while (!groups.has(current) && !path.has(current)) {
      path.add(current);
      const parent = parents.get(current);
      if (!parent || !bounced.has(parent)) break;
      current = parent;
    }
    const parent = parents.get(current);
    const group = groups.get(current) ?? (parent && !bounced.has(parent) ? `skipped:from:${parent}` : `skipped:root:${current}`);
    for (const member of path) groups.set(member, group);
    return group;
  }

  for (const node of raw.nodes) {
    if (node.kind === 'question' || !bounced.has(node.id)) {
      nodes.push({ ...node, emphasis: node.kind === 'question' || node.visit.engagement === 'read' ? 'full' : 'muted' });
      continue;
    }
    const id = groupOf(node.id);
    let group = skipped.get(id);
    if (!group) {
      group = { id, kind: 'skipped', visits: [], emphasis: 'muted' };
      skipped.set(id, group);
      nodes.push(group);
    }
    group.visits.push(node.visit);
  }

  const edges = new Map<string, TrailGraphEdge>();
  for (const edge of raw.edges) {
    const source = groups.get(edge.source) ?? edge.source;
    const target = groups.get(edge.target) ?? edge.target;
    if (source === target) continue;
    const pair = JSON.stringify([source, target]);
    if (!edges.has(pair)) edges.set(pair, { ...edge, source, target, dashed: skipped.has(target) });
  }
  return { nodes, edges: [...edges.values()] };
}
