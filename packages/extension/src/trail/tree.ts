import type { Visit } from '@trailmap/shared';

export type TrailNode = { visit: Visit; children: TrailNode[] };

/**
 * Nests Visits under the Visit they came from. Siblings and separate trails
 * stay in the order they happened. A Visit whose parent isn't in `visits` (say,
 * it was yesterday) starts a trail of its own.
 */
export function buildTrail(visits: Visit[]): TrailNode[] {
  const nodes = new Map<string, TrailNode>(visits.map((visit) => [visit.id, { visit, children: [] }]));
  const roots: TrailNode[] = [];
  for (const visit of [...visits].sort((a, b) => a.startedAt - b.startedAt)) {
    const node = nodes.get(visit.id)!;
    const parent = visit.parentVisitId === null ? undefined : nodes.get(visit.parentVisitId);
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export function startOfLocalDay(time: number): number {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
