import { ChatGptAuthError, getChatGptAuth } from './auth/auth';
import type { SecretStore } from './secrets';
import { openAiProvider } from './llm/openai';
import { LlmFailure } from './llm/provider';
import { VaultError, type Vault } from './vault';
import { CompanionRequest, type CompanionEvent, type CompanionRequestType, type CompanionResponse, type ErrorCode, type ModelDispatch } from '@trailmap/shared';

export const COMPANION_VERSION = '0.0.0';

/** What handlers may use. Later tickets add to it (secret store, mock-able base URLs); tests pass fakes. */
export interface CompanionContext {
  /** Environment the companion was started with; this is how E2E points it at mock servers (e.g. `TRAILMAP_*` variables). */
  env: Record<string, string | undefined>;
  /** Keychain (macOS) or 0600 file. Secrets are never returned in a message. */
  secrets: SecretStore;
  /** Diagnostics only: never pass tokens, keys or page text. */
  log: (line: string) => void;
  /** Auth lifecycle notifications sent by the Native Messaging host. */
  emit?: (event: CompanionEvent) => void;
  now?: () => number;
  authorizeDispatch?: (auditId: string, dispatch: ModelDispatch) => Promise<boolean>;
  acknowledgeDispatch?: (dispatchId: string, allow: boolean) => void;
  vault?: Vault;
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
  'companion.hello': (request, ctx) => ({
    type: 'companion.hello', id: request.id, version: COMPANION_VERSION,
    ...(ctx.authorizeDispatch ? { modelAudit: true } : {}),
  }),
  'auth.signIn': async ({ id }, ctx) => ({ type: 'auth.signIn', id, url: await getChatGptAuth(ctx).signIn() }),
  'auth.status': async ({ id }, ctx) => ({ type: 'auth.status', id, ...await getChatGptAuth(ctx).status() }),
  'auth.signOut': async ({ id }, ctx) => ({
    type: 'auth.signOut', id, revocationConfirmed: await getChatGptAuth(ctx).signOut(),
  }),
  'llm.complete': async ({ id, type, ...request }, ctx) => ({ type, id, output: await openAiProvider(ctx).complete(request) }),
  'llm.models': async ({ id, type }, ctx) => ({ type, id, models: await openAiProvider(ctx).models() }),
  'llm.dispatchAck': ({ id, type, dispatchId, allow }, ctx) => {
    ctx.acknowledgeDispatch?.(dispatchId, allow);
    return { type, id };
  },
  'vault.setFolder': async ({ type, id, path }, ctx) => ({ type, id, ...await configuredVault(ctx).setFolder(path) }),
  'vault.write': ({ type, id, folderId, path, markdown }, ctx) => {
    configuredVault(ctx).write(folderId, path, markdown);
    return { type, id };
  },
  'vault.remove': ({ type, id, folderId, path, sha256 }, ctx) => {
    configuredVault(ctx).remove(folderId, path, sha256);
    return { type, id };
  },
};

function configuredVault(ctx: CompanionContext): Vault {
  if (!ctx.vault) throw new VaultError('vault_unavailable', 'Vault sync is unavailable.');
  return ctx.vault;
}

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
  } catch (error) {
    if (error instanceof ChatGptAuthError || error instanceof VaultError) return errorReply(request.id, error.code, error.message);
    if (error instanceof LlmFailure) return {
      type: 'error', id: request.id, code: error.code, message: error.message, ...error.details,
    };
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
