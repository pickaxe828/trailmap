import { z } from 'zod';

/** Stable provider-independent error codes for model callers and the durable queue. */
export const LlmErrorCode = z.enum([
  'not_eligible',
  'usage_limit_exceeded',
  'usage_unavailable',
  'plan_usage_not_granted',
  'not_signed_in',
  'invalid_output',
  'provider_rejected',
  'dispatch_cancelled',
]);
export type LlmErrorCode = z.infer<typeof LlmErrorCode>;

export const LlmOutput = z.json();
export type LlmOutput = z.infer<typeof LlmOutput>;

export const LlmCompletion = z.object({
  task: z.string().min(1).max(100),
  auditId: z.uuid().optional(),
  model: z.string().min(1).max(200).optional(),
  instructions: z.string().min(1).max(16_000),
  input: z.string().min(1).max(120_000),
  schema: z.record(z.string(), LlmOutput),
  schemaName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});
export type LlmCompletion = z.infer<typeof LlmCompletion>;

/** Exact textual fields of one outbound inference request (including fallbacks), without credentials. */
export const ModelDispatch = z.object({
  provider: z.string(),
  model: z.string(),
  instructions: z.string(),
  input: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
});
export type ModelDispatch = z.infer<typeof ModelDispatch>;

export const LlmModel = z.object({ slug: z.string().min(1), displayName: z.string().min(1) });
export type LlmModel = z.infer<typeof LlmModel>;

/** Leaves room for the companion's upstream deadline and Native Messaging. */
export const LLM_REQUEST_TIMEOUT_MS = 190_000;
