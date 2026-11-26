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
 * The protocol carries account status, never ChatGPT credentials.
 */
import { z } from 'zod';
import { LlmCompletion, LlmErrorCode, LlmModel, LlmOutput, ModelDispatch, ProviderCatalogStatus, ProviderModel } from './llm';

/** The Native Messaging host name, shared by the install manifest and `chrome.runtime.connectNative`. */
export const NATIVE_HOST_NAME = 'com.trailmap.companion';

export const VaultFolder = z.object({ id: z.string(), path: z.string() });
export type VaultFolder = z.infer<typeof VaultFolder>;
export const VAULT_PICKER_TIMEOUT_MS = 130_000;

export const CompanionRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companion.hello'), id: z.string() }),
  z.object({ type: z.literal('auth.signIn'), id: z.string() }),
  z.object({ type: z.literal('auth.status'), id: z.string() }),
  z.object({ type: z.literal('auth.signOut'), id: z.string() }),
  z.object({ type: z.literal('keys.set'), id: z.string(), provider: z.literal('anthropic'), key: z.string().trim().min(1).max(512).regex(/^[!-~]+$/) }),
  z.object({ type: z.literal('keys.status'), id: z.string(), provider: z.literal('anthropic') }),
  LlmCompletion.extend({ type: z.literal('llm.complete'), id: z.string() }),
  z.object({ type: z.literal('llm.models'), id: z.string() }),
  z.object({ type: z.literal('llm.dispatchAck'), id: z.string(), dispatchId: z.uuid(), allow: z.boolean() }),
  // Omitted path opens the picker; null turns off syncing.
  z.object({ type: z.literal('vault.setFolder'), id: z.string(), path: z.string().min(1).nullable().optional() }),
  z.object({ type: z.literal('vault.write'), id: z.string(), folderId: z.string(), path: z.string(), markdown: z.string() }),
  z.object({ type: z.literal('vault.remove'), id: z.string(), folderId: z.string(), path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
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
  'auth_in_progress',
  'auth_unavailable',
  'auth_required',
  'plan_usage_disabled',
  'vault_invalid_folder',
  'vault_unsafe_path',
  'vault_unavailable',
  ...LlmErrorCode.options,
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorDetails = z.object({
  retryAfterMs: z.number().int().positive().optional(),
  requestId: z.string().optional(),
});
export type ErrorDetails = z.infer<typeof ErrorDetails>;

export const CompanionError = ErrorDetails.extend({
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

export const ChatGptStatus = z.object({
  signedIn: z.boolean(),
  email: z.string().nullable(),
  planUsage: z.boolean(),
  signingIn: z.boolean(),
});
export type ChatGptStatus = z.infer<typeof ChatGptStatus>;

export const CompanionResponse = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companion.hello'), id: z.string(), version: z.string(), modelAudit: z.literal(true).optional(), modelProviders: z.literal(true).optional() }),
  z.object({ type: z.literal('auth.signIn'), id: z.string(), url: z.url() }),
  ChatGptStatus.extend({ type: z.literal('auth.status'), id: z.string() }),
  z.object({ type: z.literal('auth.signOut'), id: z.string(), revocationConfirmed: z.boolean() }),
  z.object({ type: z.literal('keys.set'), id: z.string(), keySet: z.boolean() }),
  z.object({ type: z.literal('keys.status'), id: z.string(), keySet: z.boolean() }),
  z.object({ type: z.literal('llm.complete'), id: z.string(), output: LlmOutput }),
  z.object({ type: z.literal('llm.models'), id: z.string(), models: z.array(ProviderModel.or(LlmModel)), providers: z.array(ProviderCatalogStatus).optional() }),
  z.object({ type: z.literal('llm.dispatchAck'), id: z.string() }),
  z.object({ type: z.literal('vault.setFolder'), id: z.string(), folder: VaultFolder.nullable(), cancelled: z.literal(true).optional() }),
  z.object({ type: z.literal('vault.write'), id: z.string() }),
  z.object({ type: z.literal('vault.remove'), id: z.string() }),
  CompanionError,
]);
export type CompanionResponse = z.infer<typeof CompanionResponse>;

/** Messages the companion pushes without being asked. */
export const CompanionEvent = z.discriminatedUnion('name', [
  z.object({ type: z.literal('event'), name: z.literal('companion.ready'), version: z.string() }),
  z.object({ type: z.literal('event'), name: z.literal('auth.completed') }),
  z.object({ type: z.literal('event'), name: z.literal('auth.changed') }),
  z.object({ type: z.literal('event'), name: z.literal('auth.failed'), message: z.string() }),
  ModelDispatch.extend({ type: z.literal('event'), name: z.literal('llm.dispatch'), auditId: z.uuid(), id: z.uuid() }),
  /** Sent just before the companion exits on an error it cannot recover from. */
  z.object({ type: z.literal('event'), name: z.literal('companion.fatal'), message: z.string() }),
]);
export type CompanionEvent = z.infer<typeof CompanionEvent>;

/** Everything that can arrive from the companion on the wire. */
export type CompanionFrame = CompanionResponse | CompanionEvent | ChunkFrame;
