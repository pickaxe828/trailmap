/**
 * Chrome Native Messaging framing: a uint32 length in native byte order
 * (little-endian on every supported target) followed by UTF-8 JSON.
 */
import { MAX_OUTGOING_FRAME_BYTES } from '@trailmap/shared';

/** Chrome refuses to send the host more than this in one message. */
export const MAX_INCOMING_FRAME_BYTES = 64 * 1024 * 1024;

export class FrameTooLargeError extends Error {
  constructor(readonly size: number, readonly limit: number) {
    super(`Frame of ${size} bytes is over the ${limit} byte limit`);
    this.name = 'FrameTooLargeError';
  }
}

const LITTLE_ENDIAN = true;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encodes one outgoing message. Throws `FrameTooLargeError` above 1 MiB: page it with `chunkMessage` first. */
export function encodeFrame(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  if (body.length > MAX_OUTGOING_FRAME_BYTES) throw new FrameTooLargeError(body.length, MAX_OUTGOING_FRAME_BYTES);
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, LITTLE_ENDIAN);
  frame.set(body, 4);
  return frame;
}

/** Reassembles frames from arbitrary stdin chunks. `push` returns the JSON text of every frame completed by this chunk. */
export class FrameDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): string[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;

    const out: string[] = [];
    let offset = 0;
    while (this.buffer.length - offset >= 4) {
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset).getUint32(0, LITTLE_ENDIAN);
      if (length > MAX_INCOMING_FRAME_BYTES) throw new FrameTooLargeError(length, MAX_INCOMING_FRAME_BYTES);
      if (this.buffer.length - offset < 4 + length) break;
      out.push(decoder.decode(this.buffer.subarray(offset + 4, offset + 4 + length)));
      offset += 4 + length;
    }
    this.buffer = this.buffer.slice(offset);
    return out;
  }
}
