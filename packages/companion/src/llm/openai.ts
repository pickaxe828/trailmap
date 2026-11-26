import { z } from 'zod';
import { LLM_PROVIDER_NAMES, LlmModel, type ModelDispatch } from '@trailmap/shared';
import { ChatGptAuthError, getChatGptAuth } from '../auth/auth';
import type { CompanionContext } from '../handle';
import { runDispatch } from './http';
import { invalidOutput, LlmFailure, outputValidator, type LlmProvider } from './provider';
import { readSse } from './sse';

const IDLE_MS = 60_000;
const DEADLINE_MS = 180_000;
const ProviderError = z.object({ code: z.string().nullish(), param: z.string().nullish() });
const FailureBody = z.object({ error: ProviderError.nullish() });
const Event = ProviderError.extend({
  type: z.string().optional(), delta: z.string().optional(), response: FailureBody.optional(),
});

class TextFormatUnsupported extends LlmFailure {}

function rejected(message: string, requestId?: string) {
  return new LlmFailure('provider_rejected', message, { requestId });
}

function apiFailure(error: z.infer<typeof ProviderError> | null | undefined, requestId?: string, status?: number) {
  switch (error?.code) {
    case 'subscription_sharing_user_not_eligible':
      return new LlmFailure('not_eligible', 'This ChatGPT account or workspace is not eligible for plan usage.', { requestId });
    case 'subscription_sharing_usage_limit_exceeded':
      return new LlmFailure('usage_limit_exceeded', 'ChatGPT plan usage is paused. Check your usage and limits in ChatGPT.', { requestId });
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return unavailable(requestId);
    case 'subscription_sharing_unsupported_capability': {
      const message = 'ChatGPT plan usage does not support a capability in this request.';
      return (status === 400 || status === undefined) && /^text(?:$|[.\[])/.test(error.param ?? '')
        ? new TextFormatUnsupported('provider_rejected', message, { requestId }) : rejected(message, requestId);
    }
    case 'subscription_sharing_route_not_supported':
      return rejected('ChatGPT plan usage does not support this API route.', requestId);
    case 'subscription_sharing_invalid_user':
      return rejected('ChatGPT could not verify the signed-in account for plan usage.', requestId);
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context':
      return rejected('ChatGPT did not authorize this request. Check the plan grant and client configuration.', requestId);
  }
  if (status === 401) return rejected('ChatGPT did not accept the account or its plan grant.', requestId);
  if (status === 403) return rejected('ChatGPT blocked this request. Check your workspace policy or region.', requestId);
  if (status === 429 || (status !== undefined && status >= 500)) return unavailable(requestId);
  return rejected('ChatGPT rejected the model request.', requestId);
}

async function checkStatus(response: Response, requestId?: string) {
  if (response.ok) return;
  const body = FailureBody.safeParse(await response.json().catch(() => null));
  throw apiFailure(body.data?.error, requestId, response.status).diagnose('http_status', response.status);
}

function unavailable(requestId?: string) {
  return new LlmFailure('usage_unavailable', 'ChatGPT plan usage is temporarily unavailable. Try again later.', {
    retryAfterMs: 5_000, requestId,
  });
}

export function openAiProvider(ctx: CompanionContext): LlmProvider {
  const base = (ctx.env.TRAILMAP_OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');

  async function accessToken() {
    try {
      return await getChatGptAuth(ctx).getAccessToken();
    } catch (error) {
      if (!(error instanceof ChatGptAuthError)) throw error;
      if (error.code === 'auth_required') throw new LlmFailure('not_signed_in', 'Sign in with ChatGPT to use your plan.').diagnose('not_signed_in', error.status);
      if (error.code === 'plan_usage_disabled') throw new LlmFailure('plan_usage_not_granted', 'Enable ChatGPT plan usage to continue.');
      throw unavailable().diagnose('auth_unavailable', error.status);
    }
  }

  async function call<T>(
    path: '/models' | '/responses', signal: AbortSignal, token: string,
    consume: (response: Response, touch: () => void, requestId?: string) => Promise<T>, body?: object,
  ): Promise<T> {
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(), IDLE_MS);
    };
    let requestId: string | undefined;
    let status: number | undefined;
    touch();
    try {
      signal.throwIfAborted();
      const response = await fetch(base + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.any([signal, idle.signal]),
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json', accept: 'text/event-stream' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      status = response.status;
      touch();
      const header = response.headers.get('x-request-id');
      if (header && /^[\w-]{1,128}$/.test(header)) requestId = header;
      await checkStatus(response, requestId);
      return await consume(response, touch, requestId);
    } catch (error) {
      if (error instanceof LlmFailure) {
        error.status ??= status;
        throw error;
      }
      const reason = signal.aborted || idle.signal.aborted ? 'deadline' : status === undefined ? 'network_error' : 'stream_read_error';
      throw unavailable(requestId).diagnose(reason, status);
    } finally {
      clearTimeout(timer!);
      idle.abort();
    }
  }

  const models = async (signal: AbortSignal) => call('/models', signal, await accessToken(), async (response, _touch, requestId) => {
    const catalog = z.object({ models: z.array(z.unknown()) }).safeParse(await response.json().catch(() => undefined));
    if (!catalog.success) throw unavailable(requestId).diagnose('catalog_unavailable');
    const listedModels = catalog.data.models.flatMap((entry) => {
      const listed = z.object({ visibility: z.literal('list'), slug: z.string(), display_name: z.string() }).safeParse(entry);
      if (!listed.success) return [];
      const model = LlmModel.safeParse({ slug: listed.data.slug, displayName: listed.data.display_name });
      return model.success ? [model.data] : [];
    });
    return { listedModels, status: response.status };
  });

  return {
    async complete(request) {
      const validate = outputValidator(request.schema);
      const signal = AbortSignal.timeout(DEADLINE_MS);
      const catalog = request.model ? undefined : await models(signal);
      const model = request.model ?? catalog?.listedModels[0]?.slug;
      if (!model) throw rejected('No ChatGPT plan models are available for this account.').diagnose('catalog_unavailable', catalog?.status);
      const body = {
        model,
        instructions: request.instructions,
        input: [{ role: 'user', content: request.input }] satisfies ModelDispatch['input'],
        store: false,
        stream: true,
      };
      const { $schema: _dialect, ...schema } = request.schema;
      const infer = async (payload: Omit<typeof body, 'input'> & { input: ModelDispatch['input']; text?: object }) => {
        const token = await accessToken();
        return runDispatch(ctx, request.auditId, {
          provider: LLM_PROVIDER_NAMES.chatgpt, model, instructions: payload.instructions, input: payload.input,
        }, () => call('/responses', signal, token, async (response, touch, requestId) => {
          const text = await readResponse(response, touch, requestId);
          const output = validate(text);
          if (output === undefined) throw invalidOutput('ChatGPT', text);
          return output;
        }, payload));
      };
      try {
        return await infer({ ...body, text: { format: { type: 'json_schema', name: request.schemaName, strict: true, schema } } });
      } catch (error) {
        if (!(error instanceof TextFormatUnsupported)) throw error;
      }
      const instructions = `${request.instructions}\n\nReturn only JSON matching this schema, with no Markdown:\n${JSON.stringify(schema)}`;
      try {
        return await infer({ ...body, instructions });
      } catch (error) {
        if (!(error instanceof LlmFailure) || error.code !== 'invalid_output' || error.rawOutput === undefined) throw error;
        return infer({
          ...body,
          instructions: `${instructions}\nThe previous answer did not match the schema. Repair it using the original input.`,
          input: [...body.input, { role: 'assistant', content: error.rawOutput.slice(0, 12_000) }],
        });
      }
    },
    models: async () => (await models(AbortSignal.timeout(IDLE_MS))).listedModels,
  };
}

async function readResponse(response: Response, touch: () => void, requestId?: string): Promise<string> {
  // We always ask for `text/event-stream`. ChatGPT's safety-buffered responses (`x-codex-safety-buffering-enabled`)
  // arrive as a valid SSE body with no Content-Type at all, so only a *declared* non-stream type is rejected.
  const declared = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!response.body || (declared !== undefined && declared !== 'text/event-stream')) {
    throw unavailable(requestId).diagnose('non_stream_response');
  }
  let text = '';
  let refused = false;
  for await (const frame of readSse(response.body, touch)) {
    let raw: unknown;
    try { raw = JSON.parse(frame.data); } catch { continue; }
    const { success, data } = Event.safeParse(raw);
    if (!success) continue;
    switch (data.type ?? frame.event) {
      case 'response.output_text.delta':
        text += data.delta ?? '';
        if (text.length > 1_048_576) throw new LlmFailure('invalid_output', 'ChatGPT output exceeded the allowed size.');
        break;
      case 'response.refusal.delta':
      case 'response.refusal.done':
        refused = true;
        break;
      case 'response.completed':
        if (!refused) return text;
        throw new LlmFailure('invalid_output', 'ChatGPT refused to produce the requested output.', { requestId });
      case 'response.incomplete':
        throw new LlmFailure('invalid_output', 'ChatGPT did not finish the output.', { requestId });
      case 'response.failed':
        throw apiFailure(data.response?.error, requestId).diagnose('stream_error');
      case 'error':
        throw apiFailure(data, requestId).diagnose('stream_error');
    }
  }
  throw unavailable(requestId).diagnose('stream_ended_early');
}
