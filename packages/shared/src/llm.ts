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
  'invalid_api_key',
  'provider_rate_limited',
  'provider_unreachable',
  'provider_quota_exceeded',
  'model_not_found',
]);
export type LlmErrorCode = z.infer<typeof LlmErrorCode>;

export const LlmOutput = z.json();
export type LlmOutput = z.infer<typeof LlmOutput>;

export const LlmProviderId = z.enum(['chatgpt', 'anthropic', 'ollama']);
export type LlmProviderId = z.infer<typeof LlmProviderId>;
export const LLM_PROVIDER_NAMES: Record<LlmProviderId, string> = { chatgpt: 'ChatGPT plan', anthropic: 'Anthropic', ollama: 'Ollama' };

export type LlmTaskGroup = 'extraction' | 'notes';
export function llmTaskGroup(task: string): LlmTaskGroup {
  return task === 'page_enrichment' || task === 'page_summary' ? 'extraction' : 'notes';
}

export const ANTHROPIC_DEFAULT_MODELS: Record<LlmTaskGroup, string> = {
  extraction: 'claude-haiku-5-5', notes: 'claude-sonnet-5-5',
};

export const LlmCompletion = z.object({
  provider: LlmProviderId.optional(),
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

export const LlmModel = z.object({ slug: z.string().min(1).max(200), displayName: z.string().min(1) });
export type LlmModel = z.infer<typeof LlmModel>;

export const ProviderModel = LlmModel.extend({ provider: LlmProviderId });
export const ProviderCatalogStatus = z.object({ provider: LlmProviderId, error: LlmErrorCode.or(z.literal('internal')).optional() });

/** Leaves room for the companion's upstream deadline and Native Messaging. */
export const LLM_REQUEST_TIMEOUT_MS = 190_000;
