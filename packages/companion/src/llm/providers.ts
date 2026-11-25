import { LlmProviderId, type LlmCompletion } from '@trailmap/shared';
import type { CompanionContext } from '../handle';
import { anthropicProvider } from './anthropic';
import { ollamaProvider } from './ollama';
import { openAiProvider } from './openai';
import { LlmFailure } from './provider';

const providers = { chatgpt: openAiProvider, anthropic: anthropicProvider, ollama: ollamaProvider };

export function complete(ctx: CompanionContext, request: LlmCompletion) {
  return providers[request.provider ?? 'chatgpt'](ctx).complete(request);
}

export async function modelCatalog(ctx: CompanionContext) {
  const catalogs = await Promise.all(LlmProviderId.options.map(async (provider) => {
    try {
      const models = await providers[provider](ctx).models();
      return { status: { provider }, models: models.map((model) => ({ ...model, provider })) };
    } catch (error) {
      return { status: { provider, error: error instanceof LlmFailure ? error.code : 'internal' as const }, models: [] };
    }
  }));
  return { models: catalogs.flatMap((catalog) => catalog.models), providers: catalogs.map(({ status }) => status) };
}
