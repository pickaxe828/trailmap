/**
 * Re-records the MiniLM vectors in `src/threads/fixtures/embeddings.json` from the descriptions that `buildDescription` makes.
 * Needs the network once (it downloads Xenova/all-MiniLM-L6-v2), so it is a manual step and never part of the tests:
 *
 *   cd packages/extension && bun scripts/record-thread-fixtures.ts
 *
 * Run it after changing `buildDescription` or the fixtures. `fixtures.test.ts` fails until you do.
 */
import { env, pipeline } from '@huggingface/transformers';
import { quantize } from '../src/embeddings/embedder';
import { buildDescription } from '../src/threads/description';
import { FIXTURE_EXPEDITIONS } from '../src/threads/fixtures/expeditions';

env.cacheDir = `${process.env.TMPDIR ?? '/tmp'}/trailmap-minilm-cache`;
const extract = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const texts = FIXTURE_EXPEDITIONS.map(({ parts }) => buildDescription(parts, true));
const output = await extract(texts, { pooling: 'mean', normalize: true });
const data = output.data as Float32Array;
const recorded = Object.fromEntries(FIXTURE_EXPEDITIONS.map(({ id }, i) => {
  const q8 = quantize(data.slice(i * 384, (i + 1) * 384))!;
  return [id, { text: texts[i], vector: Buffer.from(q8.buffer).toString('base64') }];
}));
await Bun.write(new URL('../src/threads/fixtures/embeddings.json', import.meta.url), `${JSON.stringify(recorded, null, 1)}\n`);
console.log(`recorded ${texts.length} descriptions`);
