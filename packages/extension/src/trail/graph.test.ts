import { expect, test } from 'bun:test';
import type { Query, Visit } from '@trailmap/shared';
import { buildExpeditionTrail, buildTrailGraph } from './graph';

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

test('an Expedition keeps its question and engaged Visits, groups skipped pages, and preserves the trail beyond them', () => {
  const question: Query = { id: 'q', visitId: 'search', engine: 'google', q: 'CRDT deletes', at: 1, expeditionId: null };
  const graph = buildExpeditionTrail([
    { ...visit('search', 1, null, 'search'), engagement: 'bounced' },
    { ...visit('branch', 2, 'search', 'new-tab'), engagement: 'bounced' },
    { ...visit('hop', 3, 'branch'), engagement: 'bounced' },
    { ...visit('tab', 4, 'search', 'new-tab'), engagement: 'bounced' },
    { ...visit('article', 5, 'hop'), engagement: 'read' },
    visit('reference', 6, 'search'),
    { ...visit('different-branch', 7, 'article', 'new-tab'), engagement: 'bounced' },
  ], [question]);
  const stop = (id: string) => graph.nodes.find((node) => node.id === id);
  expect(stop('search')).toMatchObject({ kind: 'question', query: question });
  expect(stop('article')).toMatchObject({ emphasis: 'full' });
  expect(stop('reference')).toMatchObject({ emphasis: 'muted' });
  const skipped = graph.nodes.filter((node) => node.kind === 'skipped');
  expect(skipped.map((node) => node.visits.map(({ id }) => id))).toEqual([['branch', 'hop', 'tab'], ['different-branch']]);
  expect(graph.edges.map(({ source, target, dashed }) => [source, target, !!dashed])).toEqual([
    ['search', skipped[0]!.id, true],
    [skipped[0]!.id, 'article', false],
    ['search', 'reference', false],
    ['article', skipped[1]!.id, true],
  ]);
});

test('legacy Queries without a Visit can appear as roots, but linked Queries cannot resurrect absent Visits', () => {
  const legacy: Query = { id: 'legacy', engine: 'google', q: 'tombstones', at: 1, expeditionId: null };
  const graph = buildTrailGraph([], [{ ...legacy, id: 'missing', visitId: 'absent' }, legacy]);
  expect(graph.nodes).toEqual([{ id: 'query:legacy', kind: 'question', visit: null, query: legacy }]);
  expect(graph.edges).toEqual([]);
});
