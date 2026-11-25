import { generateKeyPairSync, sign } from 'node:crypto';

export const MOCK_EMAIL = 'reader@example.test';
export const MOCK_CLIENT = 'oaiapp_trailmap_mock';
export const MOCK_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

export function startMockOAuth(otherRoutes = (_request: Request): Response | Promise<Response> => new Response(null, { status: 404 })) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'mock-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, URL>();
  const exchanges: URLSearchParams[] = [];
  const revocations: URLSearchParams[] = [];
  const behavior = {
    scope: MOCK_SCOPE,
    claims: {} as Record<string, unknown>,
    refreshError: null as string | null,
    beforeRefresh: undefined as (() => Promise<void>) | undefined,
    revokeStatus: 200,
    badSignature: false,
  };
  let rotation = 0;

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const issuer = url.origin;
      switch (url.pathname) {
        case '/api/accounts/authorize': {
          const redirect = new URL(url.searchParams.get('redirect_uri')!);
          const code = crypto.randomUUID();
          codes.set(code, url);
          redirect.searchParams.set('code', code);
          redirect.searchParams.set('state', url.searchParams.get('state')!);
          if (url.searchParams.get('client_id') === 'dynamic_agent_client') {
            redirect.searchParams.set('client_id', MOCK_CLIENT);
          }
          return Response.redirect(redirect);
        }
        case '/.well-known/openid-configuration':
          return Response.json({ issuer, jwks_uri: issuer + '/jwks', revocation_endpoint: issuer + '/revoke' });
        case '/jwks':
          return Response.json({ keys: [jwk] });
        case '/revoke':
          revocations.push(new URLSearchParams(await request.text()));
          return new Response(null, { status: behavior.revokeStatus });
        case '/api/accounts/oauth/token': {
          if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
            return new Response(null, { status: 415 });
          }
          const form = new URLSearchParams(await request.text());
          exchanges.push(form);
          if (form.get('grant_type') === 'refresh_token') {
            await behavior.beforeRefresh?.();
            if (behavior.refreshError) return Response.json({ error: behavior.refreshError }, { status: 400 });
            rotation += 1;
            return Response.json({
              access_token: 'mock-access-' + rotation,
              refresh_token: 'mock-refresh-' + rotation,
              token_type: 'Bearer',
              scope: behavior.scope,
              expires_in: 3600,
            });
          }
          const code = form.get('code') ?? '';
          const pending = codes.get(code);
          if (!pending || !codes.delete(code)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
          const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
          const header = encode({ alg: 'RS256', kid: jwk.kid });
          const claims = encode({
            iss: issuer,
            aud: MOCK_CLIENT,
            sub: 'mock-reader',
            nonce: pending.searchParams.get('nonce'),
            email: MOCK_EMAIL,
            email_verified: true,
            exp: 2_000_000_000,
            iat: 1_700_000_000,
            ...behavior.claims,
          });
          const signed = header + '.' + claims;
          return Response.json({
            access_token: 'mock-access-0',
            refresh_token: 'mock-refresh-0',
            id_token: signed + '.' + sign(
              'RSA-SHA256', Buffer.from(behavior.badSignature ? signed + 'tampered' : signed), privateKey,
            ).toString('base64url'),
            token_type: 'Bearer',
            scope: behavior.scope,
            expires_in: 3600,
          });
        }
        default:
          return otherRoutes(request);
      }
    },
  });
  return { server, origin: server.url.origin, behavior, exchanges, revocations };
}

if (import.meta.main) {
  const mock = startMockOAuth();
  console.log(mock.origin);
}
