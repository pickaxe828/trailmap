import { LLM_PROVIDER_NAMES, type LlmProviderId } from '@trailmap/shared';
import type { RequestErrorCode } from '../companion/client';
import { isModelJob, type ModelJobKind } from './types';

export const MODEL_JOB_LABELS: Record<ModelJobKind, string> = {
  page_enrichment: 'Page notes',
  expedition_wrap_up: 'Expedition wrap-up',
  field_notes: 'Field notes',
  merge_verdict: 'Concept matching',
  living_note: 'Living notes',
  notes_enrichment: 'My notes',
};

export function modelTaskLabel(task: string) {
  if (isModelJob(task)) return MODEL_JOB_LABELS[task];
  if (task === 'page_summary') return 'Page summary';
  if (task === 'ask') return 'Ask';
  if (task === 'forgotten') return 'Entries removed by Forget';
  return 'Model call';
}

export function modelFailureMessage(code: RequestErrorCode, provider?: LlmProviderId) {
  const name = provider ? LLM_PROVIDER_NAMES[provider] : 'The model provider';
  switch (code) {
    case 'usage_unavailable': return provider === 'chatgpt' ? 'ChatGPT plan usage is temporarily unavailable.' : `${name} is temporarily unavailable.`;
    case 'usage_limit_exceeded': return 'The ChatGPT plan limit was reached.';
    case 'not_signed_in': return 'Sign in with ChatGPT to use your plan.';
    case 'plan_usage_not_granted': return 'Enable ChatGPT plan usage to continue.';
    case 'not_eligible': return 'This ChatGPT account cannot use plan usage.';
    case 'api_key_missing': return 'Save an Anthropic API key in Settings.';
    case 'invalid_api_key': return 'Anthropic did not accept the saved API key or its permissions.';
    case 'provider_quota_exceeded': return 'Check the model provider’s billing and spend limits.';
    case 'provider_rate_limited': return `${name} is receiving too many requests.`;
    case 'provider_unreachable': return `${name} could not be reached.`;
    case 'model_not_found': return 'The selected model is not available.';
    case 'not_connected': return 'The companion is not connected.';
    case 'timeout': return 'The model call timed out.';
    case 'invalid_output': return 'The model returned a reply Trailmap could not use.';
    case 'provider_rejected': return `${name} rejected the model request.`;
    case 'dispatch_cancelled': return 'Trailmap cancelled the model call.';
    default: return 'Trailmap could not complete the model job.';
  }
}
