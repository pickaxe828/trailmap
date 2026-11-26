import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { z } from 'zod';

export const DYNAMIC_CLIENT = 'dynamic_agent_client';
export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct';
const REQUESTED_SCOPE = 'openid profile email offline_access resource.invoke ' + PLAN_USAGE_SCOPE;
const HTTP_TIMEOUT_MS = 5_000;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});

export class OAuthError extends Error {
  constructor(readonly code: string | undefined, readonly status?: number) {
    super('The ChatGPT token request failed');
  }
}

export class OpenAiOAuth {
  private readonly issuer: string;
  private readonly resource: string;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(env: Record<string, string | undefined>) {
    this.issuer = new URL(env.TRAILMAP_OPENAI_AUTH_BASE_URL ?? 'https://auth.openai.com').origin;
    this.resource = env.TRAILMAP_OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  authorize(params: {
    clientId: string;
    hostId: string;
    state: string;
    nonce: string;
    challenge: string;
    redirect: string;
    email?: string | null;
    requestConsent: boolean;
  }): string {
    const url = new URL('/api/accounts/authorize', this.issuer);
    url.search = new URLSearchParams({
      client_id: params.clientId,
      ext_agent_host_id: params.hostId,
      response_type: 'code',
      redirect_uri: params.redirect,
      scope: REQUESTED_SCOPE,
      resource: this.resource,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.challenge,
      code_challenge_method: 'S256',
    }).toString();
    if (params.clientId === DYNAMIC_CLIENT) url.searchParams.set('agent_name_hint', 'Trailmap');
    if (params.email) url.searchParams.set('login_hint', params.email);
    if (params.requestConsent) url.searchParams.set('prompt', 'consent');
    return url.href;
  }

  async exchange(clientId: string, code: string, verifier: string, redirect: string) {
    return this.tokens({
      grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect,
    });
  }

  async refresh(clientId: string, token: string) {
    return this.tokens({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token });
  }

  private async tokens(params: Record<string, string>) {
    const response = await this.post(new URL('/api/accounts/oauth/token', this.issuer), {
      ...params, resource: this.resource,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const failure = z.object({ error: z.string() }).safeParse(body);
      throw new OAuthError(failure.data?.error, response.status);
    }
    return tokenResponse.parse(body);
  }

  async verifyIdentity(idToken: string, clientId: string, now: number, nonce?: string) {
    if (!this.jwks) {
      const url = await this.discover('jwks_uri');
      this.jwks ??= createRemoteJWKSet(url, {
        timeoutDuration: HTTP_TIMEOUT_MS,
        cooldownDuration: 0,
        [customFetch]: (url, options) => fetch(url, { ...options, redirect: 'error' }),
      });
    }
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: this.issuer,
      audience: clientId,
      requiredClaims: ['sub', 'exp', 'iat'],
      currentDate: new Date(now),
      clockTolerance: 5,
    });
    if (
      !payload.sub ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
      (payload.azp !== undefined && payload.azp !== clientId)
    ) {
      throw new Error('The ChatGPT ID token failed validation');
    }
    return {
      subject: payload.sub,
      email: payload.email_verified === true && typeof payload.email === 'string' && payload.email.trim()
        ? payload.email : null,
    };
  }

  async revoke(clientId: string, token: string): Promise<boolean> {
    let endpoint: URL | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        endpoint ??= await this.discover('revocation_endpoint');
        const response = await this.post(endpoint, { token, token_type_hint: 'refresh_token', client_id: clientId });
        if (response.status < 500) return response.status === 200;
      } catch {
        // A connection or discovery failure may clear on a retry.
      }
      if (attempt < 2) await Bun.sleep(200 * 2 ** attempt);
    }
    return false;
  }

  private async discover(field: 'jwks_uri' | 'revocation_endpoint'): Promise<URL> {
    const response = await fetch(new URL('/.well-known/openid-configuration', this.issuer), {
      redirect: 'error', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('ChatGPT discovery failed');
    const metadata = z.object({ issuer: z.string(), [field]: z.string() }).parse(await response.json());
    const endpoint = new URL(metadata[field]!);
    if (metadata.issuer !== this.issuer || endpoint.origin !== this.issuer || endpoint.username || endpoint.password) {
      throw new Error('Unexpected ChatGPT discovery endpoint');
    }
    return endpoint;
  }

  private post(url: URL, fields: Record<string, string>) {
    return fetch(url, {
      method: 'POST',
      body: new URLSearchParams(fields),
      redirect: 'error',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }
}
