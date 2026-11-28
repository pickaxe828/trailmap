import { expect, test } from 'bun:test';
import type { Concept, Edge } from '@trailmap/shared';
import { ALL_LABELS_MAX, buildAtlasGraph, isConceptShown, shouldLabelAll, topConceptIds } from './graph';

const concept = (id: string, exposure: number, firstSeen = 1): Concept => ({
  id, name: id, aliases: [], kind: 'concept', gloss: id, embedding: null, exposure, firstSeen,
});

test('the Atlas turns visible Concepts into exposure-sized nodes joined only by semantic Edges', () => {
  const edge: Edge = { id: 'semantic', from: 'CRDT', to: 'Tombstone', type: 'uses', weight: 1, evidence: ['visit'] };
  const graph = buildAtlasGraph([concept('CRDT', 5), concept('Tombstone', 2)], [
    edge,
    { ...edge, id: 'reverse', type: 'part_of', from: 'Tombstone', to: 'CRDT', weight: 2 },
    { ...edge, id: 'bridge', type: 'teaches', from: 'visit' },
    { ...edge, id: 'provisional', to: 'One-off mention' },
  ]);

  expect(graph.nodes()).toEqual(['CRDT', 'Tombstone']);
  expect(graph.neighbors('CRDT')).toEqual(['Tombstone']);
  expect(graph.size).toBe(1);
  expect(graph.getEdgeAttribute('CRDT', 'Tombstone', 'weight')).toBe(3);
  expect(graph.getNodeAttribute('CRDT', 'size')).toBeGreaterThan(graph.getNodeAttribute('Tombstone', 'size'));
});

test('the default Atlas ranks Concepts by exposure and caps what it shows', () => {
  const graph = buildAtlasGraph([concept('Peripheral', 1), concept('Core', 5), concept('Related', 3)], []);
  expect([...topConceptIds(graph, 2)]).toEqual(['Core', 'Related']);
});

test('replaying the Atlas reveals Concepts at firstSeen without adding lower-ranked Concepts', () => {
  const graph = buildAtlasGraph([concept('Early', 3, 10), concept('Later', 5, 20), concept('Peripheral', 1, 10)], []);
  const top = topConceptIds(graph, 2);
  const shownAt = (cutoff: number, focused?: string) => graph.filterNodes((id, node) => isConceptShown(id, node.firstSeen, { top, cutoff, focused }));

  expect(shownAt(9)).toEqual([]);
  expect(shownAt(10)).toEqual(['Early']);
  expect(shownAt(19, 'Later')).toEqual(['Early']);
  expect(shownAt(20)).toEqual(['Later', 'Early']);
  expect(shownAt(20, 'Peripheral')).toEqual(['Later', 'Early', 'Peripheral']);
});

test('learned and studied concepts are solid nodes; the rest were only seen on pages', () => {
  const graph = buildAtlasGraph([{ ...concept('Tombstone', 1), strength: 'learned' }, { ...concept('CRDT', 1), strength: 'studied' }, concept('Gossip', 2)], []);
  expect(['Tombstone', 'CRDT', 'Gossip'].map((id) => graph.getNodeAttribute(id, 'strength'))).toEqual(['learned', 'studied', 'seen']);
});

test('a sparse map labels every node; a busy one leaves the culling to label collisions', () => {
  expect(ALL_LABELS_MAX).toBeGreaterThanOrEqual(6);
  expect(shouldLabelAll(0)).toBe(false);
  for (const count of [1, 2, 6, ALL_LABELS_MAX]) expect(shouldLabelAll(count)).toBe(true);
  expect(shouldLabelAll(ALL_LABELS_MAX + 1)).toBe(false);
});
