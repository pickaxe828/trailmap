import type { SecretStore } from './secrets';
import { CompanionRequest, type CompanionRequestType, type CompanionResponse, type ErrorCode } from '@trailmap/shared';

export const COMPANION_VERSION = '0.0.0';

/** What handlers may use. Later tickets add to it (secret store, mock-able base URLs); tests pass fakes. */
export interface CompanionContext {
  /** Environment the companion was started with; this is how E2E points it at mock servers (e.g. `TRAILMAP_*` variables). */
  env: Record<string, string | undefined>;
  /** Keychain (macOS) or 0600 file. Secrets are never returned in a message. */
  secrets: SecretStore;
  /** Diagnostics only: never pass tokens, keys or page text. */
  log: (line: string) => void;
  /** Overrides for tests. */
  handlers?: Partial<Handlers>;
}

export type Handlers = {
  [T in CompanionRequestType]: (
    request: Extract<CompanionRequest, { type: T }>,
    ctx: CompanionContext,
  ) => Promise<Extract<CompanionResponse, { type: T }>> | Extract<CompanionResponse, { type: T }>;
};

/** One entry per verb in `CompanionRequest`: adding a verb to the schema fails typecheck until it has a handler. */
export const defaultHandlers: Handlers = {
  'companion.hello': (request) => ({ type: 'companion.hello', id: request.id, version: COMPANION_VERSION }),
};

function errorReply(id: string | null, code: ErrorCode, message: string): CompanionResponse {
  return { type: 'error', id, code, message };
}

function idOf(raw: unknown): string | null {
  return typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string' ? raw.id : null;
}

/** Validates one decoded message against the shared schema and answers it. Never throws. */
export async function handleMessage(raw: unknown, ctx: CompanionContext): Promise<CompanionResponse> {
  const parsed = CompanionRequest.safeParse(raw);
  if (!parsed.success) {
    const type = typeof raw === 'object' && raw !== null && 'type' in raw ? raw.type : undefined;
    const known = typeof type === 'string' && Object.hasOwn(defaultHandlers, type);
    return known
      ? errorReply(idOf(raw), 'invalid_message', 'Malformed message')
      : errorReply(idOf(raw), 'unknown_message', 'Unknown message type');
  }
  const request = parsed.data;
  const handler = (ctx.handlers?.[request.type] ?? defaultHandlers[request.type]) as (
    r: CompanionRequest,
    c: CompanionContext,
  ) => Promise<CompanionResponse> | CompanionResponse;
  try {
    return await handler(request, ctx);
  } catch {
    // Deliberately drops the error text: handlers touch secrets and page text.
    ctx.log(`handler for ${request.type} failed`);
    return errorReply(request.id, 'internal', 'The companion failed to handle this message');
  }
}

/** Same, starting from the frame's JSON text. */
export async function handleFrame(json: string, ctx: CompanionContext): Promise<CompanionResponse> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return errorReply(null, 'invalid_json', 'Message is not valid JSON');
  }
  return handleMessage(raw, ctx);
}
