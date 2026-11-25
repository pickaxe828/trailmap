import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ChatGptStatus, ErrorCode } from '@trailmap/shared';
import { z } from 'zod';
import type { CompanionContext } from '../handle';
import { DYNAMIC_CLIENT, OAuthError, OpenAiOAuth, PLAN_USAGE_SCOPE } from './oauth';

const HOST_KEY = 'chatgpt.host-id';
const ACCOUNT_KEY = 'chatgpt.account';
const CALLBACK_PATH = '/auth/callback';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const REFRESH_MARGIN_MS = 60_000;

const sessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  idToken: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.number(),
});
const accountSchema = z.object({
  clientId: z.string(),
  subject: z.string(),
  email: z.string().nullable(),
  session: sessionSchema.optional(),
});
type Account = z.infer<typeof accountSchema>;

type Attempt = {
  server: ReturnType<typeof Bun.serve>;
  timer: ReturnType<typeof setTimeout>;
  claimed: boolean;
};

export class ChatGptAuthError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
  }
}

const authByContext = new WeakMap<CompanionContext, ChatGptAuth>();

export function getChatGptAuth(ctx: CompanionContext): ChatGptAuth {
  let auth = authByContext.get(ctx);
  if (!auth) {
    auth = new ChatGptAuth(ctx);
    authByContext.set(ctx, auth);
  }
  return auth;
}

export function disposeChatGptAuth(ctx: CompanionContext) {
  authByContext.get(ctx)?.close();
  authByContext.delete(ctx);
}

export class ChatGptAuth {
  private readonly oauth: OpenAiOAuth;
  private readonly now: () => number;
  private attempt?: Attempt;
  private pendingClientId?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private tokenFlight?: Promise<string>;
  private signOutFlight?: Promise<boolean>;
  private closed = false;

  constructor(private readonly ctx: CompanionContext) {
    this.oauth = new OpenAiOAuth(ctx.env);
    this.now = ctx.now ?? Date.now;
  }

  async status(): Promise<ChatGptStatus> {
    const account = await this.readAccount();
    return {
      signedIn: Boolean(account?.session),
      email: account?.session ? account.email : null,
      planUsage: account?.session?.scopes.includes(PLAN_USAGE_SCOPE) ?? false,
      signingIn: this.attempt !== undefined,
    };
  }

  signIn(): Promise<string> {
    return this.exclusive(async () => {
      if (this.attempt) throw new ChatGptAuthError('auth_in_progress', 'ChatGPT sign-in is already in progress.');
      const account = await this.readAccount();
      if (account?.session?.scopes.includes(PLAN_USAGE_SCOPE)) {
        throw new ChatGptAuthError('auth_unavailable', 'You are already signed in to ChatGPT.');
      }
      let hostId = await this.ctx.secrets.get(HOST_KEY);
      if (!hostId) {
        hostId = 'urn:uuid:' + crypto.randomUUID();
        await this.ctx.secrets.set(HOST_KEY, hostId);
      }
      const clientId = account?.clientId ?? this.pendingClientId ?? DYNAMIC_CLIENT;
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      let attempt: Attempt;
      const fetch = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        if (url.origin !== redirect.origin || url.pathname !== CALLBACK_PATH || request.method !== 'GET') {
          return callbackPage('Not found.', 404);
        }
        const received = Buffer.from(url.searchParams.get('state') ?? '');
        const expected = Buffer.from(state);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
          return callbackPage('This callback does not match the sign-in attempt.', 400);
        }
        if (attempt.claimed || this.attempt !== attempt) return callbackPage('This callback has already been used.', 409);

        attempt.claimed = true;
        clearTimeout(attempt.timer);
        try {
          await this.exclusive(async () => {
            if (this.attempt !== attempt || this.signOutFlight) throw new Error('Sign-in ended');
            await this.complete(url, clientId, verifier, redirect.href, nonce, account);
          });
          this.endAttempt(attempt);
          this.ctx.emit?.({ type: 'event', name: 'auth.completed' });
          return callbackPage('Signed in. You can close this tab.');
        } catch (error) {
          this.endAttempt(attempt);
          const message = error instanceof ChatGptAuthError ? error.message : 'ChatGPT sign-in failed. Try again in Trailmap.';
          if (!this.closed) this.ctx.emit?.({ type: 'event', name: 'auth.failed', message });
          return callbackPage(message, 400);
        }
      };
      if (this.closed) throw new ChatGptAuthError('auth_unavailable', 'The companion connection closed.');
      const server = this.listen(fetch);
      const redirect = new URL(CALLBACK_PATH, server.url);
      const timer = setTimeout(() => {
        this.endAttempt(attempt);
        this.ctx.emit?.({ type: 'event', name: 'auth.failed', message: 'ChatGPT sign-in timed out. Try again in Trailmap.' });
      }, SIGN_IN_TIMEOUT_MS);
      attempt = { server, timer, claimed: false };
      this.attempt = attempt;
      this.ctx.emit?.({ type: 'event', name: 'auth.changed' });
      return this.oauth.authorize({
        clientId, hostId, state, nonce, challenge, redirect: redirect.href, email: account?.email,
        requestConsent: Boolean(account?.session),
      });
    });
  }

  signOut(): Promise<boolean> {
    this.signOutFlight ??= this.exclusive(async () => {
      if (this.attempt) this.endAttempt(this.attempt);
      this.pendingClientId = undefined;
      const account = await this.readAccount();
      const refreshToken = account?.session?.refreshToken;
      const confirmed = !refreshToken || await this.oauth.revoke(account.clientId, refreshToken);
      if (account?.session) await this.writeAccount({ ...account, session: undefined });
      this.ctx.emit?.({ type: 'event', name: 'auth.changed' });
      return confirmed;
    }).finally(() => {
      this.signOutFlight = undefined;
    });
    return this.signOutFlight;
  }

  /** For companion inference callers only. The shared flight includes reading and atomically replacing the token set. */
  getAccessToken(): Promise<string> {
    if (this.signOutFlight) return Promise.reject(new ChatGptAuthError('auth_required', 'ChatGPT sign-out is in progress.'));
    this.tokenFlight ??= this.exclusive(() => this.freshAccessToken())
      .then((token) => {
        if (this.signOutFlight) throw new ChatGptAuthError('auth_required', 'ChatGPT sign-out is in progress.');
        return token;
      })
      .finally(() => {
        this.tokenFlight = undefined;
      });
    return this.tokenFlight;
  }

  close(): void {
    this.closed = true;
    if (this.attempt) this.endAttempt(this.attempt);
  }

  private async freshAccessToken(): Promise<string> {
    const account = await this.readAccount();
    const session = account?.session;
    if (!session) throw new ChatGptAuthError('auth_required', 'Sign in with ChatGPT to continue.');
    if (!session.scopes.includes(PLAN_USAGE_SCOPE)) {
      throw new ChatGptAuthError('plan_usage_disabled', 'ChatGPT plan usage is off.');
    }
    if (session.expiresAt - this.now() > REFRESH_MARGIN_MS) return session.accessToken;
    if (!session.refreshToken && session.expiresAt > this.now()) return session.accessToken;
    if (!session.refreshToken) return this.requireSignIn(account);

    let tokens: Awaited<ReturnType<OpenAiOAuth['refresh']>>;
    try {
      tokens = await this.oauth.refresh(account.clientId, session.refreshToken);
    } catch (error) {
      if (error instanceof OAuthError && error.code && (
        ['invalid_grant', 'invalid_refresh_token', 'token_expired'].includes(error.code) ||
        error.code.startsWith('refresh_token_')
      )) {
        return this.requireSignIn(account);
      }
      throw new ChatGptAuthError('auth_unavailable', 'Could not refresh the ChatGPT session.');
    }
    if (!tokens.refresh_token || tokens.refresh_token === session.refreshToken) return this.requireSignIn(account);
    const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? session.scopes;
    const next = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: session.idToken,
      scopes,
      expiresAt: this.now() + tokens.expires_in * 1000,
    };
    // Signing keys and identity claims can change. Keep the previously verified ID token unless its replacement validates.
    if (tokens.id_token) {
      try {
        const identity = await this.oauth.verifyIdentity(tokens.id_token, account.clientId, this.now());
        if (identity.subject === account.subject) next.idToken = tokens.id_token;
      } catch {
        // Refresh is bound to the issued client and refresh grant. The verified account stays unchanged.
      }
    }
    await this.writeAccount({ ...account, session: next });
    if (!scopes.includes(PLAN_USAGE_SCOPE)) {
      this.ctx.emit?.({ type: 'event', name: 'auth.changed' });
      throw new ChatGptAuthError('plan_usage_disabled', 'ChatGPT plan usage is off.');
    }
    return next.accessToken;
  }

  private async requireSignIn(account: Account): Promise<never> {
    await this.writeAccount({ ...account, session: undefined });
    this.ctx.emit?.({ type: 'event', name: 'auth.changed' });
    throw new ChatGptAuthError('auth_required', 'Your ChatGPT session ended. Sign in again.');
  }

  private async complete(
    callback: URL, requestedClient: string, verifier: string, redirect: string, nonce: string, account: Account | null,
  ): Promise<void> {
    if (callback.searchParams.has('error')) {
      throw new ChatGptAuthError('auth_unavailable', 'ChatGPT did not authorize this sign-in.');
    }
    const issuedClient = callback.searchParams.get('client_id');
    const clientId = requestedClient === DYNAMIC_CLIENT ? issuedClient : requestedClient;
    const code = callback.searchParams.get('code');
    if (!code || !clientId?.startsWith('oaiapp_') || (issuedClient && issuedClient !== clientId)) {
      throw new Error('Invalid authorization callback');
    }
    let tokens: Awaited<ReturnType<OpenAiOAuth['exchange']>>;
    try {
      tokens = await this.oauth.exchange(clientId, code, verifier, redirect);
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'invalid_grant') {
        // Retain this registration for an explicit retry, without saving an unverified account.
        this.pendingClientId = clientId;
      }
      throw error;
    }
    if (!tokens.id_token || tokens.scope === undefined) throw new Error('Incomplete authorization grant');
    const identity = await this.oauth.verifyIdentity(tokens.id_token, clientId, this.now(), nonce);
    if (account && identity.subject !== account.subject) throw new Error('Unexpected ChatGPT account');
    if (this.closed) throw new Error('Sign-in ended');
    await this.writeAccount({
      clientId,
      ...identity,
      session: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        scopes: tokens.scope.split(/\s+/).filter(Boolean),
        expiresAt: this.now() + tokens.expires_in * 1000,
      },
    });
    this.pendingClientId = undefined;
  }

  private listen(fetch: (request: Request) => Promise<Response>) {
    const options = { hostname: '127.0.0.1', idleTimeout: 30, fetch };
    try {
      return Bun.serve({ ...options, port: 1455 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      return Bun.serve({ ...options, port: 0 });
    }
  }

  private endAttempt(attempt: Attempt) {
    clearTimeout(attempt.timer);
    if (this.attempt === attempt) this.attempt = undefined;
    // Graceful stop lets the callback that completed sign-in deliver its browser response.
    void attempt.server.stop();
  }

  private async readAccount(): Promise<Account | null> {
    const record = await this.ctx.secrets.get(ACCOUNT_KEY);
    return record === null ? null : accountSchema.parse(JSON.parse(record));
  }

  private writeAccount(account: Account): Promise<void> {
    return this.ctx.secrets.set(ACCOUNT_KEY, JSON.stringify(account));
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
}

function callbackPage(message: string, status = 200): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
