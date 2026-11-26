import { describe, expect, test } from 'bun:test';
import type { Visit } from '@trailmap/shared';
import { buildTrail, startOfLocalDay, type TrailNode } from './tree';

let n = 0;
function visit(id: string, parentVisitId: string | null, startedAt: number): Visit {
  n++;
  return {
    id, url: `http://learn.test/${id}`, canonicalUrl: `http://learn.test/${id}`, title: id, tabId: n,
    parentVisitId, transition: 'link', startedAt, activeMs: 0, scrollDepth: 0, engagement: 'bounced', expeditionId: null,
  };
}
/** Renders a trail as nested ids, e.g. "a(b(b2),c)". */
const show = (nodes: TrailNode[]): string =>
  nodes.map((node) => (node.children.length ? `${node.visit.id}(${show(node.children)})` : node.visit.id)).join(',');

describe('buildTrail', () => {
  test('puts a Visit under the Visit it came from', () => {
    expect(show(buildTrail([visit('a', null, 1), visit('b', 'a', 2), visit('c', 'b', 3)]))).toBe('a(b(c))');
  });

  test('keeps siblings in the order they happened', () => {
    expect(show(buildTrail([visit('a', null, 1), visit('c', 'a', 4), visit('b', 'a', 2), visit('b2', 'b', 3)]))).toBe('a(b(b2),c)');
  });

  test('separate trails are separate roots, in order', () => {
    expect(show(buildTrail([visit('x', null, 5), visit('a', null, 1), visit('y', 'x', 6)]))).toBe('a,x(y)');
  });

  test('a Visit whose parent is not in the list (an earlier day) starts a trail of its own', () => {
    expect(show(buildTrail([visit('b', 'yesterday', 2), visit('c', 'b', 3)]))).toBe('b(c)');
  });

  test('an empty list gives an empty trail', () => {
    expect(buildTrail([])).toEqual([]);
  });
});

describe('startOfLocalDay', () => {
  test('is local midnight of the given time', () => {
    const noon = new Date(2026, 10, 25, 12, 30).getTime();
    expect(startOfLocalDay(noon)).toBe(new Date(2026, 10, 25, 0, 0, 0, 0).getTime());
  });
});
