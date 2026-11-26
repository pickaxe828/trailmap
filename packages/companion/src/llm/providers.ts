import { LlmProviderId, type LlmCompletion } from '@trailmap/shared';
import type { CompanionContext } from '../handle';
import { anthropicProvider } from './anthropic';
import { resolveChatGptDefault } from './chatgpt-default';
import { ollamaProvider } from './ollama';
import { openAiProvider } from './openai';
import { LlmFailure } from './provider';

const providers = { chatgpt: openAiProvider, anthropic: anthropicProvider, ollama: ollamaProvider };

export async function complete(ctx: CompanionContext, request: LlmCompletion) {
  const provider = request.provider ?? 'chatgpt';
  try {
    return await providers[provider](ctx).complete(request);
  } catch (error) {
    const failure = error instanceof LlmFailure ? error : undefined;
    const code = failure?.code ?? 'internal';
    const reason = failure?.reason ?? code;
    const status = failure?.status;
    ctx.log(`llm.complete failed provider=${provider} code=${code} reason=${reason}${status === undefined ? '' : ` status=${status}`}`);
    throw error;
  }
}

export async function modelCatalog(ctx: CompanionContext) {
  const catalogs = await Promise.all(LlmProviderId.options.map(async (provider) => {
    try {
      const models = await providers[provider](ctx).models();
      const extraction = provider === 'chatgpt' ? resolveChatGptDefault(models, 'extraction') : undefined;
      const notes = provider === 'chatgpt' ? resolveChatGptDefault(models, 'notes') : undefined;
      const status = extraction && notes
        ? { provider, defaultModels: { extraction: extraction.slug, notes: notes.slug } }
        : { provider };
      return { status, models: models.map((model) => ({ ...model, provider })) };
    } catch (error) {
      return { status: { provider, error: error instanceof LlmFailure ? error.code : 'internal' as const }, models: [] };
    }
  }));
  return { models: catalogs.flatMap((catalog) => catalog.models), providers: catalogs.map(({ status }) => status) };
}
