import { z } from 'zod';
import { LLM_PROVIDER_NAMES, LlmModel } from '@trailmap/shared';
import type { CompanionContext } from '../handle';
import { CATALOG_DEADLINE_MS, INFERENCE_DEADLINE_MS, JSON_HEADERS, rateLimited, requestJson, runDispatch } from './http';
import { invalidOutput, LlmFailure, outputValidator, type LlmProvider } from './provider';

const label = LLM_PROVIDER_NAMES.ollama;
const Catalog = z.object({ models: z.array(z.unknown()) });
const InstalledModel = z.object({ name: z.string(), remote_model: z.string().nullish(), remote_host: z.string().nullish() });
const Reply = z.object({ done: z.boolean(), done_reason: z.string().optional(), message: z.object({ content: z.string() }) });
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
    const { body, status } = await requestJson(label, `${origin(ctx)}/api/tags`, {
      signal: AbortSignal.timeout(CATALOG_DEADLINE_MS),
    }, httpError);
    const catalog = Catalog.safeParse(body);
    if (!catalog.success) throw new LlmFailure('usage_unavailable', 'Ollama did not return a model catalog.').diagnose('catalog_unavailable', status);
    const listedModels = catalog.data.models.flatMap((data) => {
      const entry = InstalledModel.safeParse(data);
      if (!entry.success || entry.data.remote_model || entry.data.remote_host || cloud.test(entry.data.name)) return [];
      const model = LlmModel.safeParse({ slug: entry.data.name, displayName: entry.data.name });
      return model.success ? [model.data] : [];
    });
    return { listedModels, status };
  }

  return {
    models: async () => (await models()).listedModels,
    async complete(request) {
      const validate = outputValidator(request.schema);
      const signal = AbortSignal.timeout(INFERENCE_DEADLINE_MS);
      // Check the installed catalog even for explicit IDs: a local tag can be an alias for a cloud model.
      const { listedModels: installed, status: catalogStatus } = await models();
      const model = request.model ?? installed[0]?.slug;
      if (!model || !installed.some(({ slug }) => slug === model)) {
        throw new LlmFailure('model_not_found', 'Choose an installed local Ollama model in Trailmap Settings.')
          .diagnose('catalog_unavailable', catalogStatus);
      }
      const base = origin(ctx);
      const { $schema: _dialect, ...schema } = request.schema;
      const input = [{ role: 'user' as const, content: request.input }];
      const system = `${request.instructions}\n\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}`;
      const infer = (instructions: string) => runDispatch(ctx, request.auditId, { provider: label, model, instructions, input }, async () => {
        const { body, status } = await requestJson(label, `${base}/api/chat`, {
          method: 'POST', signal, headers: JSON_HEADERS,
          body: JSON.stringify({ model, stream: false, think: false, keep_alive: '10m', format: schema,
            options: { num_ctx: 32768, temperature: 0 }, messages: [{ role: 'system', content: instructions }, ...input],
          }),
        }, httpError);
        const reply = Reply.safeParse(body).data;
        const text = reply?.message.content;
        const output = reply?.done && reply.done_reason === 'stop' && text !== undefined && text.length <= 1_048_576
          ? validate(text) : undefined;
        if (output === undefined) throw invalidOutput(label, text, status);
        return output;
      });
      try {
        return await infer(system);
      } catch (error) {
        if (!(error instanceof LlmFailure) || error.code !== 'invalid_output') throw error;
        return infer(`${system}\nThe previous answer did not match the schema. Return a corrected JSON object.`);
      }
    },
  };
}
