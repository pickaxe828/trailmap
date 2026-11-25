/**
 * Paging for messages over Chrome's 1 MiB host-to-extension frame limit.
 * The JSON text is cut into UTF-8 byte slices, each base64-encoded into a
 * `chunk` frame, so every frame's size is bounded no matter what the text holds.
 */
import type { ChunkFrame } from './messages';

/** Chrome rejects host-to-extension frames above this many bytes (and closes the port). */
export const MAX_OUTGOING_FRAME_BYTES = 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/**
 * Returns the message itself when its JSON fits in `maxFrameBytes`, otherwise
 * `chunk` frames that each fit and that a `ChunkAssembler` joins back.
 * The message needs a string `id`, which is how chunks are matched.
 */
export function chunkMessage(
  message: object,
  maxFrameBytes: number = MAX_OUTGOING_FRAME_BYTES,
): Array<object> {
  const json = JSON.stringify(message);
  const bytes = encoder.encode(json);
  if (bytes.length <= maxFrameBytes) return [message];

  const id = 'id' in message ? message.id : undefined;
  if (typeof id !== 'string') throw new Error('Only messages with an id can be paged');
  // Worst-case envelope: indexes and totals of 9 digits.
  const overhead = encoder.encode(
    JSON.stringify({ type: 'chunk', id, index: 999999999, total: 999999999, data: '' } satisfies ChunkFrame),
  ).length;
  const rawBytesPerChunk = Math.floor(((maxFrameBytes - overhead) / 4)) * 3;
  if (rawBytesPerChunk <= 0) throw new Error('Frame cap too small to page a message');

  const total = Math.ceil(bytes.length / rawBytesPerChunk);
  return Array.from({ length: total }, (_, index) => ({
    type: 'chunk',
    id,
    index,
    total,
    data: toBase64(bytes.subarray(index * rawBytesPerChunk, (index + 1) * rawBytesPerChunk)),
  }));
}

/** Joins `chunk` frames. `add` returns the original message once its last chunk arrives, otherwise null. */
export class ChunkAssembler {
  private readonly partial = new Map<string, Uint8Array[]>();

  add(frame: ChunkFrame): unknown | null {
    const pieces = this.partial.get(frame.id) ?? new Array<Uint8Array>(frame.total);
    pieces[frame.index] = fromBase64(frame.data);
    this.partial.set(frame.id, pieces);
    if (Array.from(pieces).some((p) => p === undefined) || pieces.length !== frame.total) return null;

    this.partial.delete(frame.id);
    const whole = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const piece of pieces) {
      whole.set(piece, offset);
      offset += piece.length;
    }
    return JSON.parse(decoder.decode(whole));
  }
}
