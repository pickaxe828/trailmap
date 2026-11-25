/**
 * Native Messaging protocol between the extension and the companion
 * (docs/PLAN.md §6.1). Every incoming message is validated against these
 * schemas. The companion has a short, fixed command set: never add a
 * general-purpose "fetch a URL" or "read a file" message.
 *
 * Wire format: 4-byte native-endian length + UTF-8 JSON, both directions.
 * Requests carry an `id` the response echoes. The companion can also push
 * `event`s, and pages results over 1 MB as `chunk`s (see chunking.ts).
 *
 * Only `companion.hello` exists so far; later tickets add auth.*, keys.set,
 * llm.* and vault.write.
 */
import { z } from 'zod';

/** The Native Messaging host name, shared by the install manifest and `chrome.runtime.connectNative`. */
export const NATIVE_HOST_NAME = 'com.trailmap.companion';

export const CompanionRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companion.hello'), id: z.string() }),
]);
export type CompanionRequest = z.infer<typeof CompanionRequest>;
export type CompanionRequestType = CompanionRequest['type'];

export const ErrorCode = z.enum([
  /** The frame was not valid JSON. */
  'invalid_json',
  /** Valid JSON, but not a verb the companion knows (including anything that isn't an object). */
  'unknown_message',
  /** A known verb with a malformed payload. */
  'invalid_message',
  /** A handler failed unexpectedly. The message never contains secrets or page text. */
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const CompanionError = z.object({
  type: z.literal('error'),
  id: z.string().nullable(),
  code: ErrorCode,
  message: z.string(),
});
export type CompanionError = z.infer<typeof CompanionError>;

/** One page of a response whose JSON was over the 1 MB frame cap. `data` is base64 of a slice of its UTF-8 bytes. */
export const ChunkFrame = z.object({
  type: z.literal('chunk'),
  id: z.string(),
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  data: z.string(),
});
export type ChunkFrame = z.infer<typeof ChunkFrame>;

export const CompanionResponse = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companion.hello'), id: z.string(), version: z.string() }),
  CompanionError,
]);
export type CompanionResponse = z.infer<typeof CompanionResponse>;

/** Messages the companion pushes without being asked. */
export const CompanionEvent = z.discriminatedUnion('name', [
  z.object({ type: z.literal('event'), name: z.literal('companion.ready'), version: z.string() }),
  /** Sent just before the companion exits on an error it cannot recover from. */
  z.object({ type: z.literal('event'), name: z.literal('companion.fatal'), message: z.string() }),
]);
export type CompanionEvent = z.infer<typeof CompanionEvent>;

/** Everything that can arrive from the companion on the wire. */
export type CompanionFrame = CompanionResponse | CompanionEvent | ChunkFrame;
