import { RAW_MODEL_OUTPUT_MAX_BYTES, type LlmOutput, type ModelDispatch } from '@trailmap/shared';
import type { CompanionContext } from '../handle';
import { LlmFailure } from './provider';

function cappedRawOutput(text: string | undefined) {
  if (text === undefined) return;
  const bytes = new TextEncoder().encode(text);
  // Do not replace a partially cut UTF-8 character with bytes beyond the cap.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(0, RAW_MODEL_OUTPUT_MAX_BYTES), { stream: true });
}

/** Authorize and report exactly one provider attempt, including fallback and repair attempts. */
export async function runDispatch(
  ctx: CompanionContext, auditId: string | undefined, dispatch: ModelDispatch, run: () => Promise<LlmOutput>,
) {
  const finish = auditId ? await ctx.authorizeDispatch?.(auditId, dispatch) : true;
  if (!finish) throw new LlmFailure('dispatch_cancelled', 'Trailmap did not authorize this model call.');
  try {
    const output = await run();
    if (typeof finish === 'function') finish({ outcome: 'succeeded', output });
    return output;
  } catch (error) {
    if (typeof finish === 'function') {
      const failure = error instanceof LlmFailure ? error : undefined;
      const errorCode = failure?.code ?? 'internal';
      finish(errorCode === 'dispatch_cancelled' ? { outcome: 'cancelled', errorCode }
        : { outcome: 'failed', errorCode, output: cappedRawOutput(failure?.rawOutput) });
    }
    throw error;
  }
}

/** Never surface raw upstream error messages, which can contain credentials or prompt text. */
export async function requestJson(
  label: string, url: string, init: RequestInit, httpError: (res: Response, body: unknown) => LlmFailure,
): Promise<{ body: unknown; status: number }> {
  try {
    const res = await fetch(url, { ...init, redirect: 'error' });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw httpError(res, body).diagnose('http_status', res.status);
    return { body, status: res.status };
  } catch (error) {
    if (error instanceof LlmFailure) throw error;
    throw new LlmFailure('provider_unreachable', `${label} is not reachable.`)
      .diagnose(init.signal?.aborted ? 'deadline' : 'network_error');
  }
}

export function rateLimited(label: string, res: Response) {
  const header = res.headers.get('retry-after');
  const seconds = header !== null && /^\d+$/.test(header) ? Number(header) : 0;
  const retryAfterMs = seconds > 0 ? Math.min(seconds, 900) * 1000 : undefined;
  return new LlmFailure('provider_rate_limited', `${label} is rate limiting requests. Try again later.`, { retryAfterMs });
}

export const JSON_HEADERS = { 'content-type': 'application/json' };
export const INFERENCE_DEADLINE_MS = 180_000;
export const CATALOG_DEADLINE_MS = 10_000;
