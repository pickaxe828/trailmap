import { expect, test } from 'bun:test';
import type { Embedder } from '../embeddings/embedder';
import { SearchIndex, reciprocalRankFusion, type SearchDocument } from './index';

const embedder: Embedder = {
  async embed(texts) {
    return texts.map((text) => Float32Array.from(
      /tombstone|deletion marker|logical deletion/i.test(text) && !text.includes('Gravestones') ? [1, 0] : [0, 1],
    ));
  },
};

const document = (id: string, title: string, body: string, kind: SearchDocument['kind'] = 'page'): SearchDocument => ({
  id, title, body, kind, href: `https://learn.test/${id}`, detail: '', semanticText: `${title}\n${body}`,
});

test('RRF rewards corroborated results without comparing scores between rankers', () => {
  expect(reciprocalRankFusion([['keyword', 'both', 'last'], ['semantic', 'both']]))
    .toEqual(['both', 'keyword', 'semantic', 'last']);
});

test('hybrid search ranks corroborated results above keyword-only and semantic-only matches', async () => {
  const index = new SearchIndex(embedder);
  index.update([
    document('keyword', 'Tombstone inscriptions', 'Gravestones for genealogy'),
    document('both', 'Deleting in CRDTs', 'A tombstone acts as a deletion marker.'),
    document('semantic', 'Session notes', 'Logical deletion keeps replicas in sync.', 'note'),
    document('unrelated', 'Sourdough', 'Keeping a starter'),
  ]);
  expect(index.keyword('tombstone', 10).map(({ id }) => id)).toEqual(['keyword', 'both']);
  expect((await index.search('tombstone', 10)).map(({ id }) => id)).toEqual(['both', 'keyword', 'semantic']);
});

test('a note edited during embedding does not retain the old semantic match', async () => {
  const first = Promise.withResolvers<Float32Array[]>();
  const note = document('session', 'Session notes', 'Logical deletion keeps replicas in sync.', 'note');
  const index = new SearchIndex({ async embed(texts) {
    return texts[0] === note.semanticText ? first.promise : embedder.embed(texts);
  } });
  index.update([note]);
  const search = index.search('tombstone', 10);
  index.update([document('session', 'Session notes', 'Decorating a sourdough loaf.', 'note')]);
  first.resolve([Float32Array.of(1, 0)]);
  expect(await search).toEqual([]);
});

test('keyword matches remain when the local Embedder rejects', async () => {
  const index = new SearchIndex({ async embed() { throw new Error('unavailable'); } });
  index.update([document('page', 'Replication', 'A tombstone marks a delete.')]);
  expect((await index.search('tombstone', 5)).map(({ id }) => id)).toEqual(['page']);
});
