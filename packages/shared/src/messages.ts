/**
 * Native Messaging protocol between the extension and the companion
 * (docs/PLAN.md §6.1). Every incoming message is validated against these
 * schemas. The companion has a short, fixed command set: never add a
 * general-purpose "fetch a URL" or "read a file" message.
 *
 * Only `companion.hello` exists so far; later tickets add auth.*, keys.set,
 * llm.* and vault.write.
 */
import { z } from 'zod';

export const CompanionRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companion.hello'), id: z.string() }),
]);
export type CompanionRequest = z.infer<typeof CompanionRequest>;

export const CompanionResponse = z.discriminatedUnion('type', [
  z.object({ type: z.literal('companion.hello'), id: z.string(), version: z.string() }),
  z.object({ type: z.literal('error'), id: z.string().nullable(), message: z.string() }),
]);
export type CompanionResponse = z.infer<typeof CompanionResponse>;
