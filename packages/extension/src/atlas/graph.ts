import { ConceptRelationType, type Concept, type Edge } from '@trailmap/shared';
import { UndirectedGraph } from 'graphology';
import type { EvidenceStrength } from '../concepts/strength';
import louvain from 'graphology-communities-louvain';

export type ConceptNode = {
  label: string;
  firstSeen: number;
  size: number;
  x: number;
  y: number;
  community: number;
  /** Learned and studied concepts are drawn solid. A concept only seen on pages is drawn faded. */
  strength: EvidenceStrength;
};
export type ConceptLink = { weight: number };
export type AtlasGraph = UndirectedGraph<ConceptNode, ConceptLink>;

function seededRandom() {
  let seed = 18;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Build the visual graph from an already-visible Concept projection. */
export function buildAtlasGraph(concepts: readonly (Concept & { strength?: EvidenceStrength })[], edges: readonly Edge[]): AtlasGraph {
  const ranked = [...concepts].sort((a, b) => b.exposure - a.exposure || a.firstSeen - b.firstSeen || a.id.localeCompare(b.id));
  const graph: AtlasGraph = new UndirectedGraph({ allowSelfLoops: false });
  const rng = seededRandom();
  for (const { id, name, firstSeen, exposure, strength } of ranked) {
    graph.addNode(id, {
      label: name, firstSeen, size: Math.min(24, 4 + 3 * Math.log2(1 + exposure)),
      x: rng(), y: rng(), community: 0, strength: strength ?? 'seen',
    });
  }
  for (const { from, to, type, weight } of edges) {
    if (from === to || !graph.hasNode(from) || !graph.hasNode(to) || !ConceptRelationType.safeParse(type).success) continue;
    if (graph.hasEdge(from, to)) graph.updateEdgeAttribute(from, to, 'weight', (current) => (current ?? 0) + weight);
    else graph.addEdge(from, to, { weight });
  }
  if (graph.order) {
    louvain.assign(graph, { rng });
    // Anchor each community's colour to its highest-ranked Concept instead of Louvain's arbitrary IDs.
    const paletteKeys = new Map<number, number>();
    graph.forEachNode((id, { community }) => {
      if (!paletteKeys.has(community)) {
        let hash = 0;
        for (const char of id) hash = Math.imul(hash, 31) + char.charCodeAt(0) | 0;
        paletteKeys.set(community, hash >>> 0);
      }
    });
    graph.updateEachNodeAttributes((_, node) => ({ ...node, community: paletteKeys.get(node.community)! }));
  }
  return graph;
}

export function topConceptIds(graph: AtlasGraph, limit = 80, scope?: ReadonlySet<string>): ReadonlySet<string> {
  const ids = graph.nodes();
  return new Set((scope ? ids.filter((id) => scope.has(id)) : ids).slice(0, Math.max(0, limit)));
}

/** With this few nodes on the map every label is drawn; past it the renderer culls only labels that would collide. */
export const ALL_LABELS_MAX = 8;
export const shouldLabelAll = (shown: number) => shown > 0 && shown <= ALL_LABELS_MAX;

export type AtlasFilter = { top: ReadonlySet<string>; cutoff: number; focused?: string; scope?: ReadonlySet<string>; labelAll?: boolean };

export function isConceptInScope(id: string, firstSeen: number, { cutoff, scope }: Pick<AtlasFilter, 'cutoff' | 'scope'>) {
  return firstSeen <= cutoff && (!scope || scope.has(id));
}

/** Keep a fixed top set while scrubbing, so advancing time only adds nodes. */
export function isConceptShown(id: string, firstSeen: number, filter: AtlasFilter) {
  return isConceptInScope(id, firstSeen, filter) && (filter.top.has(id) || id === filter.focused);
}
