import { expect, test } from 'bun:test';
import { ChunkAssembler, chunkMessage } from './chunking';

const big = { type: 'companion.hello', id: 'r1', version: 'é😀'.repeat(5000) };

test('a message that fits is sent as a single frame, unchanged', () => {
  expect(chunkMessage({ type: 'companion.hello', id: 'r1', version: '1' }, 1000)).toEqual([
    { type: 'companion.hello', id: 'r1', version: '1' },
  ]);
});

test('an oversized message is paged into chunks that each fit the cap and reassemble exactly', () => {
  const cap = 2000;
  const frames = chunkMessage(big, cap);
  expect(frames.length).toBeGreaterThan(3);
  for (const frame of frames) {
    expect(new TextEncoder().encode(JSON.stringify(frame)).length).toBeLessThanOrEqual(cap);
    expect((frame as { type: string }).type).toBe('chunk');
  }
  const assembler = new ChunkAssembler();
  const results = frames.map((f) => assembler.add(f as never));
  expect(results.slice(0, -1).every((r) => r === null)).toBe(true);
  expect(results.at(-1)).toEqual(big);
});

test('chunks of different ids can interleave', () => {
  const a = chunkMessage({ ...big, id: 'a' }, 2000);
  const b = chunkMessage({ ...big, id: 'b' }, 2000);
  const assembler = new ChunkAssembler();
  const out: unknown[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const frames of [a, b]) {
      const frame = frames[i];
      if (frame) out.push(assembler.add(frame as never));
    }
  }
  expect(out.filter(Boolean).map((m) => (m as { id: string }).id).sort()).toEqual(['a', 'b']);
});
