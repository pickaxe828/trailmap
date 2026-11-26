import { expect, test } from 'bun:test';
import { FrameDecoder, FrameTooLargeError, encodeFrame } from './framing';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test('a frame is a 4-byte native-endian length followed by UTF-8 JSON', () => {
  const frame = encodeFrame({ hello: 'é' });
  const body = new TextEncoder().encode('{"hello":"é"}');
  expect(new DataView(frame.buffer, frame.byteOffset).getUint32(0, true)).toBe(body.length); // little-endian on every supported target
  expect(decode(frame.subarray(4))).toBe('{"hello":"é"}');
});

test('a decoder yields each message once, however the bytes are split across chunks', () => {
  const frames = [{ a: 1 }, { b: 'two' }, { c: '😀'.repeat(50) }].map(encodeFrame);
  const all = Uint8Array.from(frames.flatMap((f) => [...f]));
  for (const cuts of [[1], [2], [4], [5], [7, 11], [3, 4, 5, 6, 7]]) {
    const decoder = new FrameDecoder();
    const out: string[] = [];
    let at = 0;
    for (const cut of [...cuts, all.length]) {
      out.push(...decoder.push(all.subarray(at, cut)));
      at = cut;
    }
    expect(out.map((s) => JSON.parse(s))).toEqual([{ a: 1 }, { b: 'two' }, { c: '😀'.repeat(50) }]);
  }
});

test('several frames in one chunk all come out', () => {
  const two = Uint8Array.from([...encodeFrame({ n: 1 }), ...encodeFrame({ n: 2 })]);
  expect(new FrameDecoder().push(two).map((s) => JSON.parse(s))).toEqual([{ n: 1 }, { n: 2 }]);
});

test('encoding refuses a frame over the 1 MiB cap Chrome enforces', () => {
  expect(() => encodeFrame({ text: 'x'.repeat(1024 * 1024) })).toThrow(FrameTooLargeError);
});

test('a decoder refuses a length prefix over the 64 MiB cap Chrome enforces on requests', () => {
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, 64 * 1024 * 1024 + 1, true);
  expect(() => new FrameDecoder().push(header)).toThrow(FrameTooLargeError);
});
