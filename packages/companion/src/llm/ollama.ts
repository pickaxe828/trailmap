import { z } from 'zod';
import { LLM_PROVIDER_NAMES, LlmModel } from '@trailmap/shared';
import type { CompanionContext } from '../handle';
import { authorize, CATALOG_DEADLINE_MS, INFERENCE_DEADLINE_MS, JSON_HEADERS, rateLimited, requestJson } from './http';
import { LlmFailure, outputValidator, type LlmProvider } from './provider';

const label = LLM_PROVIDER_NAMES.ollama;
const Catalog = z.object({ models: z.array(z.unknown()) });
const InstalledModel = z.object({ name: z.string(), remote_model: z.string().nullish(), remote_host: z.string().nullish() });
const Reply = z.object({ done: z.literal(true), done_reason: z.literal('stop'), message: z.object({ content: z.string().max(1_048_576) }) });
const cloud = /(?:^|[:-])cloud(?:$|:)/i;

function origin(ctx: CompanionContext) {
  const url = URL.parse(ctx.env.TRAILMAP_OLLAMA_BASE_URL ?? 'http://localhost:11434');
  if (!url || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new LlmFailure('provider_rejected', 'Ollama must run on this computer.');
  }
  return url.origin;
}

function httpError(res: Response) {
  if (res.status === 404) return new LlmFailure('model_not_found', 'The selected Ollama model is not installed locally.');
  if (res.status === 429) return rateLimited(label, res);
  if (res.status >= 500) return new LlmFailure('usage_unavailable', 'Ollama is temporarily unavailable.');
  return new LlmFailure('provider_rejected', 'Ollama rejected the model request.');
}

export function ollamaProvider(ctx: CompanionContext): LlmProvider {
  async function models() {
    const catalog = Catalog.safeParse(await requestJson(label, `${origin(ctx)}/api/tags`, {
      signal: AbortSignal.timeout(CATALOG_DEADLINE_MS),
    }, httpError));
    if (!catalog.success) throw new LlmFailure('usage_unavailable', 'Ollama did not return a model catalog.');
    return catalog.data.models.flatMap((data) => {
      const entry = InstalledModel.safeParse(data);
      if (!entry.success || entry.data.remote_model || entry.data.remote_host || cloud.test(entry.data.name)) return [];
      const model = LlmModel.safeParse({ slug: entry.data.name, displayName: entry.data.name });
      return model.success ? [model.data] : [];
    });
  }

  return {
    models,
    async complete(request) {
      const validate = outputValidator(request.schema);
      const signal = AbortSignal.timeout(INFERENCE_DEADLINE_MS);
      // Check the installed catalog even for explicit IDs: a local tag can be an alias for a cloud model.
      const installed = await models();
      const model = request.model ?? installed[0]?.slug;
      if (!model || !installed.some(({ slug }) => slug === model)) {
        throw new LlmFailure('model_not_found', 'Choose an installed local Ollama model in Trailmap Settings.');
      }
      const base = origin(ctx);
      const { $schema: _dialect, ...schema } = request.schema;
      const input = [{ role: 'user' as const, content: request.input }];
      const system = `${request.instructions}\n\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}`;
      for (const instructions of [system, `${system}\nThe previous answer did not match the schema. Return a corrected JSON object.`]) {
        await authorize(ctx, request, { provider: label, model, instructions, input });
        const reply = Reply.safeParse(await requestJson(label, `${base}/api/chat`, {
          method: 'POST', signal, headers: JSON_HEADERS,
          body: JSON.stringify({ model, stream: false, think: false, keep_alive: '10m', format: schema,
            options: { num_ctx: 32768, temperature: 0 }, messages: [{ role: 'system', content: instructions }, ...input],
          }),
        }, httpError));
        const output = reply.success ? validate(reply.data.message.content) : undefined;
        if (output !== undefined) return output;
      }
      throw new LlmFailure('invalid_output', 'Ollama did not return JSON that matches the requested schema.');
    },
  };
}
