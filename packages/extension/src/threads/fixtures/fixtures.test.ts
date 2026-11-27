import { expect, test } from 'bun:test';
import { quantize } from '../../embeddings/embedder';
import { buildDescription } from '../description';
import { scoreMatch } from '../match';
import recorded from './embeddings.json';
import { FIXTURE_EXPEDITIONS } from './expeditions';

/** Related pairs that MiniLM scores too low to suggest. Honest misses, listed so a change to the bands shows up here. */
const KNOWN_MISSES = new Set(['edm+sidechain']);

const vectors = new Map(FIXTURE_EXPEDITIONS.map(({ id }) => {
  const entry = (recorded as Record<string, { text: string; vector: string }>)[id]!;
  return [id, Int8Array.from(Buffer.from(entry.vector, 'base64'))] as const;
}));

const pairs = FIXTURE_EXPEDITIONS.flatMap((a, i) => FIXTURE_EXPEDITIONS.slice(i + 1).map((b) => {
  const conceptIds = (e: typeof a) => e.parts.concepts.map((name) => name.toLowerCase());
  const { band } = scoreMatch({ vector: vectors.get(a.id)!, conceptIds: conceptIds(a) }, { vector: vectors.get(b.id)!, conceptIds: conceptIds(b) });
  return { name: `${a.id}+${b.id}`, related: a.topic === b.topic, band };
}));

test('the recorded vectors were made from the current descriptions', () => {
  for (const { id, parts } of FIXTURE_EXPEDITIONS) {
    expect((recorded as Record<string, { text: string }>)[id]?.text).toBe(buildDescription(parts, true));
  }
  expect(quantize(Float32Array.from(vectors.get('epaxial')!))).not.toBeNull();
});

test('related pairs such as epaxial musculature and back muscle group reach the suggestion band', () => {
  const related = pairs.filter(({ related }) => related);
  expect(related.length).toBeGreaterThanOrEqual(8);
  expect(pairs.find(({ name }) => name === 'epaxial+back-group')!.band).toBeGreaterThanOrEqual(1);
  expect(related.filter(({ band, name }) => band < 1 && !KNOWN_MISSES.has(name)).map(({ name }) => name)).toEqual([]);
});

test('unrelated pairs, such as Maillard reaction and EDM build-ups, never reach the suggestion band', () => {
  expect(pairs.find(({ name }) => name === 'maillard+edm')!.band).toBe(0);
  expect(pairs.filter(({ related, band }) => !related && band > 0).map(({ name }) => name)).toEqual([]);
});

test('automatic joins stay at the old false-positive rate: none', () => {
  expect(pairs.filter(({ related, band }) => !related && band === 2)).toEqual([]);
});
