import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompanionEvent } from '@trailmap/shared';
import { fakeSecurity } from '../fake-security';
import { handleMessage, type CompanionContext } from '../handle';
import { FileSecretStore, KeychainSecretStore } from '../secrets';
import { getChatGptAuth } from './auth';
import { MOCK_CLIENT, MOCK_EMAIL, MOCK_SCOPE, startMockOAuth } from './mock-oauth';

let mock: ReturnType<typeof startMockOAuth>;
let directory: string;
let ctx: CompanionContext;
let events: CompanionEvent[];
let now: number;

beforeEach(() => {
  mock = startMockOAuth();
  directory = mkdtempSync(join(tmpdir(), 'trailmap-auth-'));
  events = [];
  now = 1_800_000_000_000;
  ctx = {
    env: { TRAILMAP_OPENAI_AUTH_BASE_URL: mock.origin, TRAILMAP_OPENAI_BASE_URL: mock.origin + '/v1' },
    secrets: new FileSecretStore(join(directory, 'secrets.json')),
    log: () => {},
    now: () => now,
    emit: (event) => events.push(event),
  };
});

afterEach(() => {
  getChatGptAuth(ctx).close();
  mock.server.stop(true);
  rmSync(directory, { recursive: true, force: true });
});

const request = (type: string, context = ctx) => handleMessage({ type, id: type }, context);

async function begin() {
  const response = await request('auth.signIn');
  if (response.type !== 'auth.signIn') throw new Error('Could not start sign-in: ' + response.type);
  const authorize = new URL(response.url);
  if (authorize.origin !== mock.origin) throw new Error('Sign-in did not use the mock issuer');
  const approval = await fetch(authorize, { redirect: 'manual' });
  return { authorize, callback: new URL(approval.headers.get('location')!) };
}

test('signs in through the loopback and only exposes account status', async () => {
  const { authorize, callback } = await begin();
  expect(authorize.origin).toBe(mock.origin);
  expect(callback.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(callback.pathname).toBe('/auth/callback');
  expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
    client_id: 'dynamic_agent_client',
    agent_name_hint: 'Trailmap',
    ext_agent_host_id: expect.stringMatching(/^urn:uuid:[0-9a-f-]+$/),
    response_type: 'code',
    code_challenge_method: 'S256',
    state: expect.any(String),
    nonce: expect.any(String),
    redirect_uri: callback.origin + callback.pathname,
    resource: mock.origin + '/v1',
    scope: MOCK_SCOPE,
  });

  const result = await fetch(callback);
  expect(result.status).toBe(200);
  expect(await result.text()).toContain('Signed in. You can close this tab.');
  expect(events).toEqual([
    { type: 'event', name: 'auth.changed' }, { type: 'event', name: 'auth.completed' },
  ]);
  expect(await request('auth.status')).toEqual({
    type: 'auth.status', id: 'auth.status', signedIn: true, email: MOCK_EMAIL, planUsage: true, signingIn: false,
  });
  const exchange = mock.exchanges[0]!;
  expect(Object.fromEntries(exchange)).toMatchObject({
    grant_type: 'authorization_code', client_id: MOCK_CLIENT, code: callback.searchParams.get('code'),
    redirect_uri: callback.origin + callback.pathname, resource: mock.origin + '/v1',
  });
  expect(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url'))
    .toBe(authorize.searchParams.get('code_challenge')!);
  await expect(fetch(callback)).rejects.toThrow();
  expect(mock.exchanges).toHaveLength(1);
});

test('persists a realistic-size ChatGPT account and reports it signed in from a new host', async () => {
  const { run } = fakeSecurity();
  const makeStore = () => new KeychainSecretStore({ service: 'test-sign-in', dataDir: directory, run });
  ctx.secrets = makeStore();
  mock.behavior.claims.padding = 'i'.repeat(1600);
  mock.behavior.accessToken = 'access-' + 'a'.repeat(1900);
  mock.behavior.refreshToken = 'refresh-' + 'r'.repeat(1300);

  expect((await fetch((await begin()).callback)).status).toBe(200);
  const host = { ...ctx, secrets: makeStore() };
  expect((await host.secrets.get('chatgpt.account'))?.length).toBeGreaterThan(5900);
  expect(await request('auth.status', host)).toMatchObject({ signedIn: true, email: MOCK_EMAIL, planUsage: true });
});

for (const failure of ['truncated JSON', 'invalid account shape', 'read failure'] as const) {
  test(`auth.status clears the account under the lock on ${failure}`, async () => {
    let locked = false;
    let removed = false;
    const secrets = ctx.secrets;
    ctx.secrets = {
      ...secrets,
      get: async (account) => {
        if (account !== 'chatgpt.account' || removed) return secrets.get(account);
        if (failure === 'read failure') throw new Error('example sensitive record');
        return failure === 'truncated JSON' ? '{"clientId":' : '{}';
      },
      set: (account, value) => secrets.set(account, value),
      delete: async (account) => {
        expect(locked).toBe(true);
        expect(account).toBe('chatgpt.account');
        removed = true;
      },
      lockChatGptAccount: async (work) => {
        locked = true;
        try { return await work(); } finally { locked = false; }
      },
    };
    expect(await request('auth.status')).toMatchObject({ signedIn: false, email: null, planUsage: false });
    expect(removed).toBe(true);
    expect((await fetch((await begin()).callback)).status).toBe(200);
    expect(await request('auth.status')).toMatchObject({ signedIn: true });
  });
}

test('auth.status never deletes a good replacement written before it acquires the lock', async () => {
  expect((await fetch((await begin()).callback)).status).toBe(200);
  const original = ctx.secrets;
  let first = true;
  const host = {
    ...ctx,
    secrets: {
      get: async (account: string) => {
        if (first) { first = false; return '{'; }
        return original.get(account);
      },
      set: original.set.bind(original),
      delete: original.delete.bind(original),
      lockChatGptAccount: original.lockChatGptAccount.bind(original),
    },
  };
  expect(await request('auth.status', host)).toMatchObject({ signedIn: true });
  expect(await request('auth.status')).toMatchObject({ signedIn: true });
});

test('a wrong state does not consume the callback, and concurrent replays cannot exchange twice', async () => {
  const { callback } = await begin();
  const wrong = new URL(callback);
  wrong.searchParams.set('state', 'wrong-state');
  expect((await fetch(wrong)).status).toBe(400);
  expect(mock.exchanges).toHaveLength(0);
  expect(await request('auth.status')).toMatchObject({ signedIn: false, signingIn: true });

  const results = await Promise.allSettled([fetch(callback), fetch(callback)]);
  expect(results.filter((r) => r.status === 'fulfilled' && r.value.ok)).toHaveLength(1);
  expect(mock.exchanges).toHaveLength(1);
});

for (const [claim, value] of Object.entries({
  nonce: 'wrong-nonce',
  iss: 'https://wrong-issuer.example.test',
  aud: 'oaiapp_other',
  exp: 1_750_000_000,
})) {
  test('rejects an ID token with an invalid ' + claim, async () => {
    mock.behavior.claims[claim] = value;
    const { callback } = await begin();
    expect((await fetch(callback)).status).toBe(400);
    expect(await request('auth.status')).toMatchObject({ signedIn: false, signingIn: false });
    expect(events.at(-1)).toEqual({
      type: 'event', name: 'auth.failed', message: 'ChatGPT sign-in failed. Try again in Trailmap.',
    });
  });
}

test('rejects an ID token with an invalid signature', async () => {
  mock.behavior.badSignature = true;
  const { callback } = await begin();
  expect((await fetch(callback)).status).toBe(400);
  expect(await request('auth.status')).toMatchObject({ signedIn: false, signingIn: false });
});

test('uses a free loopback port when 1455 is busy', async () => {
  let busy: ReturnType<typeof Bun.serve> | undefined;
  try {
    try {
      busy = Bun.serve({ hostname: '127.0.0.1', port: 1455, fetch: () => new Response() });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
    const { callback } = await begin();
    expect(callback.port).not.toBe('1455');
    expect((await fetch(callback)).status).toBe(200);
  } finally {
    await busy?.stop(true);
  }
});

test('uses token scopes and confirms the same account when enabling plan usage', async () => {
  mock.behavior.scope = 'openid profile email';
  expect((await fetch((await begin()).callback)).ok).toBe(true);
  expect(await request('auth.status')).toMatchObject({ signedIn: true, planUsage: false });
  await expect(getChatGptAuth(ctx).getAccessToken()).rejects.toMatchObject({ code: 'plan_usage_disabled' });

  mock.behavior.scope = MOCK_SCOPE;
  mock.behavior.claims.sub = 'another-reader';
  const { authorize, callback } = await begin();
  expect(authorize.searchParams.get('client_id')).toBe(MOCK_CLIENT);
  expect(authorize.searchParams.get('prompt')).toBe('consent');
  expect(authorize.searchParams.has('agent_name_hint')).toBe(false);
  expect(authorize.searchParams.has('id_token_hint')).toBe(false);
  expect((await fetch(callback)).status).toBe(400);
  expect(await request('auth.status')).toMatchObject({ signedIn: true, email: MOCK_EMAIL, planUsage: false });

  delete mock.behavior.claims.sub;
  expect((await fetch((await begin()).callback)).ok).toBe(true);
  expect(await request('auth.status')).toMatchObject({ signedIn: true, planUsage: true });
});

test('concurrent expiry triggers one refresh and the rotated token survives restart', async () => {
  expect((await fetch((await begin()).callback)).ok).toBe(true);
  const auth = getChatGptAuth(ctx);
  expect(await auth.getAccessToken()).toBe('mock-access-0');
  now += 3_600_000;
  expect(await Promise.all(Array.from({ length: 8 }, () => auth.getAccessToken())))
    .toEqual(Array(8).fill('mock-access-1'));
  expect(mock.exchanges).toHaveLength(2);
  expect(Object.fromEntries(mock.exchanges[1]!)).toEqual({
    grant_type: 'refresh_token', client_id: MOCK_CLIENT, refresh_token: 'mock-refresh-0', resource: mock.origin + '/v1',
  });
  now += 3_600_000;
  const restarted = { ...ctx, secrets: new FileSecretStore(join(directory, 'secrets.json')) };
  expect(await getChatGptAuth(restarted).getAccessToken()).toBe('mock-access-2');
  expect(mock.exchanges[2]?.get('refresh_token')).toBe('mock-refresh-1');
});

test.each(['file', 'keychain'] as const)('two browser hosts share one rotation with the %s store', async (kind) => {
  const { run } = fakeSecurity();
  const store = () => kind === 'file' ? new FileSecretStore(join(directory, 'secrets.json'))
    : new KeychainSecretStore({ service: 'test-rotation', dataDir: directory, run });
  ctx.secrets = store();
  expect((await fetch((await begin()).callback)).ok).toBe(true);
  now += 3_600_000;
  const otherHost = { ...ctx, secrets: store() };
  mock.behavior.rejectStaleRefresh = true;
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  mock.behavior.beforeRefresh = () => { started.resolve(); return release.promise; };
  const first = getChatGptAuth(ctx).getAccessToken();
  await started.promise;
  const second = getChatGptAuth(otherHost).getAccessToken();
  // Both host requests are outstanding while the mocked issuer holds the rotation.
  release.resolve();
  expect(await Promise.allSettled([first, second])).toEqual([
    { status: 'fulfilled', value: 'mock-access-1' }, { status: 'fulfilled', value: 'mock-access-1' },
  ]);
  expect(mock.exchanges.filter((form) => form.get('grant_type') === 'refresh_token')).toHaveLength(1);
  expect(await request('auth.status', otherHost)).toMatchObject({ signedIn: true });
});

test('transient refresh errors preserve the account, and terminal errors require a new sign-in', async () => {
  const { authorize } = await begin();
  const approval = await fetch(authorize);
  expect(approval.ok).toBe(true);
  now += 3_600_000;
  const auth = getChatGptAuth(ctx);

  mock.behavior.refreshError = 'temporarily_unavailable';
  await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'auth_unavailable' });
  expect(await request('auth.status')).toMatchObject({ signedIn: true });
  mock.behavior.refreshError = 'refresh_token_reused';
  await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'auth_required' });
  expect(await request('auth.status')).toMatchObject({ signedIn: false, email: null, planUsage: false });
  const retry = await begin();
  expect(retry.authorize.searchParams.get('client_id')).toBe(MOCK_CLIENT);
  expect(retry.authorize.searchParams.get('ext_agent_host_id')).toBe(authorize.searchParams.get('ext_agent_host_id'));
});

test('sign-out revokes the latest refresh token and retains the client and host registration', async () => {
  const { authorize, callback } = await begin();
  expect((await fetch(callback)).ok).toBe(true);
  now += 3_600_000;
  await getChatGptAuth(ctx).getAccessToken();
  expect(await request('auth.signOut')).toEqual({ type: 'auth.signOut', id: 'auth.signOut', revocationConfirmed: true });
  expect(mock.revocations.map((form) => Object.fromEntries(form))).toEqual([{
    token: 'mock-refresh-1', token_type_hint: 'refresh_token', client_id: MOCK_CLIENT,
  }]);
  expect(await request('auth.status')).toMatchObject({ signedIn: false, email: null, planUsage: false });
  await expect(getChatGptAuth(ctx).getAccessToken()).rejects.toMatchObject({ code: 'auth_required' });

  const next = await begin();
  expect(next.authorize.searchParams.get('client_id')).toBe(MOCK_CLIENT);
  expect(next.authorize.searchParams.get('ext_agent_host_id')).toBe(authorize.searchParams.get('ext_agent_host_id'));
  expect(next.authorize.searchParams.get('login_hint')).toBe(MOCK_EMAIL);
  expect(next.authorize.searchParams.get('state')).not.toBe(authorize.searchParams.get('state'));
  expect(next.authorize.searchParams.get('nonce')).not.toBe(authorize.searchParams.get('nonce'));
  expect(next.authorize.searchParams.get('code_challenge')).not.toBe(authorize.searchParams.get('code_challenge')!);
  expect(next.authorize.searchParams.has('agent_name_hint')).toBe(false);
  expect(next.authorize.searchParams.has('id_token_hint')).toBe(false);
  expect((await fetch(next.callback)).ok).toBe(true);
});

test('local sign-out still clears tokens when remote revocation fails', async () => {
  expect((await fetch((await begin()).callback)).ok).toBe(true);
  mock.behavior.revokeStatus = 503;
  expect(await request('auth.signOut')).toMatchObject({ revocationConfirmed: false });
  expect(mock.revocations).toHaveLength(3);
  expect(await request('auth.status')).toMatchObject({ signedIn: false });
});

test('sign-out blocks token consumers while an ongoing refresh settles', async () => {
  expect((await fetch((await begin()).callback)).ok).toBe(true);
  now += 3_600_000;
  const auth = getChatGptAuth(ctx);
  const refreshing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  mock.behavior.beforeRefresh = () => {
    refreshing.resolve();
    return release.promise;
  };

  const active = auth.getAccessToken();
  await refreshing.promise;
  const signingOut = request('auth.signOut');
  const duringSignOut = auth.getAccessToken();
  const results = Promise.allSettled([active, duringSignOut]);
  release.resolve();
  expect(await results).toMatchObject([
    { status: 'rejected', reason: { code: 'auth_required' } },
    { status: 'rejected', reason: { code: 'auth_required' } },
  ]);
  expect(await signingOut).toMatchObject({ revocationConfirmed: true });
  expect(mock.revocations[0]?.get('token')).toBe('mock-refresh-1');
});
