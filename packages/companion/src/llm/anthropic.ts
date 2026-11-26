import { z } from 'zod';
import { ANTHROPIC_DEFAULT_MODELS, LLM_PROVIDER_NAMES, LlmModel, llmTaskGroup, type LlmOutput } from '@trailmap/shared';
import type { CompanionContext } from '../handle';
import { CATALOG_DEADLINE_MS, INFERENCE_DEADLINE_MS, JSON_HEADERS, rateLimited, requestJson, runDispatch } from './http';
import { invalidOutput, LlmFailure, outputValidator, type LlmProvider } from './provider';

export const ANTHROPIC_KEY_ACCOUNT = 'anthropic.api-key';
const label = LLM_PROVIDER_NAMES.anthropic;
const Reply = z.object({ stop_reason: z.string(), content: z.array(z.unknown()) });
const TextBlock = z.object({ type: z.literal('text'), text: z.string().max(1_048_576) });
const ApiError = z.object({ error: z.object({ details: z.object({ error_code: z.string() }).optional() }) });
const Catalog = z.object({ data: z.array(z.unknown()), has_more: z.boolean(), last_id: z.string().nullish() });
const CatalogEntry = z.object({ id: z.string(), display_name: z.string() });

function httpError(res: Response, body: unknown) {
  const code = ApiError.safeParse(body).data?.error.details?.error_code;
  if (code === 'enforced_spend_limit_reached' || res.status === 402) {
    return new LlmFailure('provider_quota_exceeded', 'Check your Anthropic billing and spend limits.');
  }
  if (res.status === 401 || res.status === 403) return new LlmFailure('invalid_api_key', 'Anthropic did not accept the saved API key or its permissions.');
  if (res.status === 404) return new LlmFailure('model_not_found', 'The selected Anthropic model is not available.');
  if (res.status === 429) return rateLimited(label, res);
  if (res.status >= 500) return new LlmFailure('usage_unavailable', 'Anthropic is temporarily unavailable.');
  return new LlmFailure('provider_rejected', 'Anthropic rejected the model request.');
}

/** Relax unsupported bounds for constrained decoding; always validate against the original schema. */
function decoderSchema(node: LlmOutput): LlmOutput {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const { $schema: _dialect, minLength: _minLength, maxLength: _maxLength, minItems, maxItems: _maxItems,
    minimum: _minimum, maximum: _maximum, exclusiveMinimum: _exclusiveMinimum, exclusiveMaximum: _exclusiveMaximum,
    multipleOf: _multipleOf, ...schema } = node;
  if (minItems === 0 || minItems === 1) schema.minItems = minItems;
  for (const key of ['properties', '$defs']) {
    const children = schema[key];
    if (children && typeof children === 'object' && !Array.isArray(children)) {
      schema[key] = Object.fromEntries(Object.entries(children).map(([name, child]) => [name, decoderSchema(child)]));
    }
  }
  for (const key of ['anyOf', 'allOf', 'prefixItems']) {
    const children = schema[key];
    if (Array.isArray(children)) schema[key] = children.map(decoderSchema);
  }
  if (schema.items !== undefined) schema.items = decoderSchema(schema.items);
  return schema;
}

export function anthropicProvider(ctx: CompanionContext): LlmProvider {
  const base = (ctx.env.TRAILMAP_ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');
  async function headers() {
    const key = await ctx.secrets.get(ANTHROPIC_KEY_ACCOUNT);
    if (!key) throw new LlmFailure('api_key_missing', 'Save an Anthropic API key in Trailmap Settings.');
    return { ...JSON_HEADERS, 'x-api-key': key, 'anthropic-version': '2026-10-21' };
  }
  return {
    async complete(request) {
      const authHeaders = await headers();
      const validate = outputValidator(request.schema);
      const group = llmTaskGroup(request.task);
      const model = request.model ?? ANTHROPIC_DEFAULT_MODELS[group];
      const messages = [{ role: 'user' as const, content: request.input }];
      const signal = AbortSignal.timeout(INFERENCE_DEADLINE_MS);
      return runDispatch(ctx, request.auditId, { provider: label, model, instructions: request.instructions, input: messages }, async () => {
        const { body, status } = await requestJson(label, `${base}/messages`, {
          method: 'POST', signal, headers: authHeaders,
          body: JSON.stringify({ model, max_tokens: 4096, system: request.instructions, messages,
            output_config: { effort: group === 'extraction' ? 'low' : 'medium', format: {
              type: 'json_schema', schema: decoderSchema(request.schema),
            } },
          }),
        }, httpError);
        const reply = Reply.safeParse(body).data;
        const block = TextBlock.safeParse(reply?.content.find((item) => TextBlock.safeParse(item).success));
        const text = block.data?.text;
        const output = reply?.stop_reason === 'end_turn' && text !== undefined ? validate(text) : undefined;
        if (output === undefined) throw invalidOutput(label, text, status);
        return output;
      });
    },
    async models() {
      const authHeaders = await headers();
      const signal = AbortSignal.timeout(CATALOG_DEADLINE_MS);
      const models = new Map<string, LlmModel>();
      const cursors = new Set<string>();
      let query = '';
      while (true) {
        const { body, status } = await requestJson(label, `${base}/models${query}`, { signal, headers: authHeaders }, httpError);
        const page = Catalog.safeParse(body);
        if (!page.success) throw new LlmFailure('usage_unavailable', 'Anthropic did not return a model catalog.')
          .diagnose('catalog_unavailable', status);
        for (const data of page.data.data) {
          const entry = CatalogEntry.safeParse(data);
          if (!entry.success) continue;
          const model = LlmModel.safeParse({ slug: entry.data.id, displayName: entry.data.display_name });
          const key = authHeaders['x-api-key'];
          if (model.success && !model.data.slug.includes(key) && !model.data.displayName.includes(key)) models.set(model.data.slug, model.data);
        }
        if (!page.data.has_more) return [...models.values()];
        const cursor = page.data.last_id;
        if (!cursor || cursors.has(cursor)) throw new LlmFailure('usage_unavailable', 'Anthropic returned an incomplete model catalog.')
          .diagnose('catalog_unavailable', status);
        cursors.add(cursor);
        query = `?after_id=${encodeURIComponent(cursor)}`;
      }
    },
  };
}
