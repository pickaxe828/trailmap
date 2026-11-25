import { expect, test } from 'bun:test';
import type { Query, Visit } from '@trailmap/shared';
import { buildTrailGraph } from './graph';

function visit(id: string, startedAt: number, parentVisitId: string | null = null, transition: Visit['transition'] = 'link'): Visit {
  return {
    id, startedAt, parentVisitId, transition, tabId: 1,
    url: 'https://reference.test/article', canonicalUrl: 'https://reference.test/article',
    title: id, activeMs: 12_000, scrollDepth: 0, engagement: 'skimmed', expeditionId: null,
  };
}

test('Visits retain their own cards and lineage even when they share a URL', () => {
  const graph = buildTrailGraph([
    visit('article', 2, 'start'), visit('branch', 3, 'start', 'new-tab'), visit('start', 1, 'yesterday'),
  ], []);
  expect(graph.nodes.map(({ id }) => id)).toEqual(['start', 'article', 'branch']);
  expect(graph.edges.map(({ source, target, kind }) => [source, target, kind])).toEqual([
    ['start', 'article', 'navigated_from'],
    ['start', 'branch', 'opened_in_new_tab'],
  ]);
});

test('a Query replaces the search results card without breaking lineage to its result', () => {
  const query: Query = { id: 'query', visitId: 'search', engine: 'google', q: 'CRDT deletes', at: 1, expeditionId: null };
  const search = visit('search', 1, null, 'search');
  const graph = buildTrailGraph([search, visit('result', 2, 'search')], [query]);
  expect(graph.nodes[0]).toEqual({ id: 'search', kind: 'question', visit: search, query });
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges[0]).toMatchObject({ source: 'search', target: 'result', kind: 'navigated_from' });
});

test('legacy Queries without a Visit can appear as roots, but linked Queries cannot resurrect absent Visits', () => {
  const legacy: Query = { id: 'legacy', engine: 'google', q: 'tombstones', at: 1, expeditionId: null };
  const graph = buildTrailGraph([], [{ ...legacy, id: 'missing', visitId: 'absent' }, legacy]);
  expect(graph.nodes).toEqual([{ id: 'query:legacy', kind: 'question', visit: null, query: legacy }]);
  expect(graph.edges).toEqual([]);
});
