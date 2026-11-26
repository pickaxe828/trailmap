/**
 * Paging for messages over Chrome's 1 MiB host-to-extension frame limit.
 * The JSON text is cut into UTF-8 byte slices, each base64-encoded into a
 * `chunk` frame, so every frame's size is bounded no matter what the text holds.
 */
import { ChunkFrame, MAX_CHUNKS, MAX_OUTGOING_FRAME_BYTES } from './messages';

const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const MAX_ASSEMBLIES = 8;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

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
  if (typeof id !== 'string' || !id.length || id.length > 256) throw new Error('Only messages with a bounded id can be paged');
  if (bytes.length > MAX_BUFFERED_BYTES) throw new Error('Paged message exceeds response budget');
  // Worst-case envelope: indexes and totals of 9 digits.
  const overhead = encoder.encode(
    JSON.stringify({ type: 'chunk', id, index: 999999999, total: 999999999, data: '' } satisfies ChunkFrame),
  ).length;
  const rawBytesPerChunk = Math.floor(((maxFrameBytes - overhead) / 4)) * 3;
  if (rawBytesPerChunk <= 0) throw new Error('Frame cap too small to page a message');

  const total = Math.ceil(bytes.length / rawBytesPerChunk);
  if (total > MAX_CHUNKS) throw new Error('Paged message exceeds chunk budget');
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
  private readonly partial = new Map<string, { pieces: Uint8Array[]; count: number; bytes: number }>();
  private bytes = 0;

  discard(id: string) {
    this.bytes -= this.partial.get(id)?.bytes ?? 0;
    this.partial.delete(id);
  }

  add(raw: unknown): unknown | null {
    const parsed = ChunkFrame.safeParse(raw);
    if (!parsed.success) {
      if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string') this.discard(raw.id);
      return null;
    }
    const { id, index, total, data } = parsed.data;
    let assembly = this.partial.get(id);
    if (!assembly) {
      if (this.partial.size >= MAX_ASSEMBLIES) return null;
      assembly = { pieces: new Array<Uint8Array>(total), count: 0, bytes: 0 };
      this.partial.set(id, assembly);
    }
    try {
      if (assembly.pieces.length !== total || assembly.pieces[index]) throw new Error('Inconsistent chunks');
      const piece = fromBase64(data);
      if (this.bytes + piece.length > MAX_BUFFERED_BYTES) throw new Error('Chunk buffer is full');
      assembly.pieces[index] = piece;
      assembly.count++;
      assembly.bytes += piece.length;
      this.bytes += piece.length;
      if (assembly.count < total) return null;
      this.discard(id);
      const whole = new Uint8Array(assembly.bytes);
      let offset = 0;
      for (const bytes of assembly.pieces) {
        whole.set(bytes, offset);
        offset += bytes.length;
      }
      const message: unknown = JSON.parse(decoder.decode(whole));
      return message && typeof message === 'object' && 'id' in message && message.id === id ? message : null;
    } catch {
      this.discard(id);
      return null;
    }
  }
}
