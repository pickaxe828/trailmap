import { expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import type { Embedder } from '../embeddings/embedder';
import { segmentVisit } from './segmenter';

const now = 10_000_000;
const parent: Expedition = {
  id: 'parent', title: 'Distributed systems', startedAt: now - 1_000, endedAt: null,
  kind: 'learning', drivingQuestion: null, fieldNotes: null, userEdited: false, threadId: null,
};
const visit: Visit = {
  id: 'visit', title: 'An unrelated site', url: 'https://example.test',
  canonicalUrl: 'https://example.test', tabId: 2, transition: 'new-tab',
  parentVisitId: 'earlier-visit', startedAt: now, activeMs: 0, scrollDepth: 0,
  engagement: 'bounced', expeditionId: null,
};
const embedder: Embedder = {
  async embed(texts) {
    return texts.map(() => Float32Array.of(0, 1));
  },
};

test('a Visit opened in another tab joins its parent Expedition despite a different topic', async () => {
  const decision = await segmentVisit({ visit, parent, candidates: [], embedder });
  expect(decision.expeditionId).toBe('parent');
});

test('a new search joins the best recent open Expedition using the Query', async () => {
  const root = { ...visit, transition: 'search' as const, parentVisitId: null };
  const queryEmbedder: Embedder = {
    async embed(texts) {
      return texts.map((text) => text === 'CRDT tombstones' ? Float32Array.of(0, 1) : Float32Array.of(1, 0));
    },
  };
  const decision = await segmentVisit({
    visit: root, query: 'CRDT tombstones', embedder: queryEmbedder,
    candidates: [
      { ...parent, id: 'old', startedAt: now - 2 * 60 * 60 * 1000 - 1, centroid: Int8Array.of(0, 127) },
      { ...parent, id: 'closed', endedAt: now - 1, centroid: Int8Array.of(0, 127) },
      { ...parent, id: 'close', centroid: Int8Array.of(76, 102) },
      { ...parent, id: 'best', centroid: Int8Array.of(0, 127) },
    ],
  });
  expect(decision.expeditionId).toBe('best');
});

test('a new root with similarity below 0.6 starts its own Expedition', async () => {
  const decision = await segmentVisit({
    visit: { ...visit, transition: 'bookmark', parentVisitId: null },
    candidates: [{ ...parent, centroid: Int8Array.of(113, 58) }],
    embedder,
  });
  expect(decision.expeditionId).toBeNull();
});

test('an unavailable Embedder cannot merge unrelated roots or break lineage', async () => {
  const unavailable: Embedder = {
    async embed() { throw new Error('Model unavailable'); },
  };
  const candidates = [{ ...parent, centroid: Int8Array.of(0, 127) }];
  const root = { ...visit, transition: 'typed' as const, parentVisitId: null };
  expect(await segmentVisit({ visit: root, candidates, embedder: unavailable }))
    .toEqual({ expeditionId: null, embedding: null });
  expect(await segmentVisit({ visit, parent, candidates, embedder: unavailable }))
    .toEqual({ expeditionId: parent.id, embedding: null });
});
