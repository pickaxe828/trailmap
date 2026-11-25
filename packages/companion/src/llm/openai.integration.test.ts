import { afterEach, beforeEach, expect, test } from 'bun:test';
import { getChatGptAuth } from '../auth/auth';
import { startMockOAuth } from '../auth/mock-oauth';
import { handleMessage, type CompanionContext } from '../handle';

let mock: ReturnType<typeof startMockOAuth>;
let ctx: CompanionContext;
let now: number;
let respond: (request: Request) => Response | Promise<Response>;

beforeEach(() => {
  respond = () => new Response(null, { status: 500 });
  mock = startMockOAuth((request) => respond(request));
  now = 1_800_000_000_000;
  const secrets = new Map<string, string>();
  ctx = {
    env: { TRAILMAP_OPENAI_AUTH_BASE_URL: mock.origin, TRAILMAP_OPENAI_BASE_URL: mock.origin + '/v1' },
    now: () => now,
    log: () => {},
    secrets: {
      get: async (key) => secrets.get(key) ?? null,
      set: async (key, value) => { secrets.set(key, value); },
      delete: async (key) => { secrets.delete(key); },
    },
  };
});

afterEach(async () => {
  getChatGptAuth(ctx).close();
  await mock.server.stop(true);
});

async function signIn() {
  const reply = await handleMessage({ type: 'auth.signIn', id: 'auth' }, ctx);
  if (reply.type !== 'auth.signIn' || new URL(reply.url).origin !== mock.origin) throw new Error('Mock sign-in not ready');
  expect((await fetch(reply.url)).ok).toBe(true);
}

const schema = {
  type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false,
};
const complete = (overrides = {}) => handleMessage({
  type: 'llm.complete', id: 'task', task: 'page_summary', model: 'mock-model',
  instructions: 'Summarize this Page.', input: 'A stored Page about café design.', schema, schemaName: 'page_summary',
  ...overrides,
}, ctx);

function frame(type: string, fields = {}) {
  return `event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`;
}

function stream(...frames: string[]) {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\n' + frames.join(''));
  // Every byte arrives separately so UTF-8, CRLF and SSE frames all cross chunk boundaries.
  let i = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (i === bytes.length) controller.close();
    else controller.enqueue(bytes.subarray(i, ++i));
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

const completed = frame('response.completed', { response: { status: 'completed' } });
const delta = (text: string) => frame('response.output_text.delta', { delta: text });

test('returns validated Page JSON from a split UTF-8 stream using a freshly rotated bearer', async () => {
  await signIn();
  now += 3_600_000;
  const requests: unknown[] = [];
  respond = async (request) => {
    requests.push([request.method, new URL(request.url).pathname, request.headers.get('authorization'), await request.json()]);
    return stream(frame('response.created'), delta('{"summary":"A café'), delta(' with room to read."}'), completed);
  };
  expect(await complete()).toEqual({ type: 'llm.complete', id: 'task', output: { summary: 'A café with room to read.' } });
  expect(requests).toEqual([['POST', '/v1/responses', 'Bearer mock-access-1', {
    model: 'mock-model', instructions: 'Summarize this Page.', input: [{ role: 'user', content: 'A stored Page about café design.' }],
    store: false, stream: true, text: { format: { type: 'json_schema', name: 'page_summary', strict: true, schema } },
  }]]);
});

test('a complete-looking Page summary is not accepted if the stream ends without a complete event', async () => {
  await signIn();
  respond = () => stream(delta('{"summary":"looks finished"}'), completed.trimEnd());
  expect(await complete()).toMatchObject({ type: 'error', code: 'usage_unavailable', retryAfterMs: 5_000 });
});

test('lists displayable models in catalog order and uses the first when no model is specified', async () => {
  await signIn();
  respond = async (request) => {
    expect(request.headers.get('authorization')).toBe('Bearer mock-access-0');
    if (new URL(request.url).pathname === '/v1/models') {
      expect(request.method).toBe('GET');
      return Response.json({ models: [
        { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
        { slug: 'visible', display_name: 'First option', visibility: 'list' },
        { slug: 'visible-2', display_name: 'Second option', visibility: 'list' },
      ] });
    }
    expect(await request.json()).toMatchObject({ model: 'visible' });
    return stream(delta('{"summary":"A Page"}'), completed);
  };
  expect(await handleMessage({ type: 'llm.models', id: 'models' }, ctx)).toEqual({
    type: 'llm.models', id: 'models', models: [
      { slug: 'visible', displayName: 'First option' }, { slug: 'visible-2', displayName: 'Second option' },
    ],
  });
  expect(await complete({ model: undefined })).toMatchObject({ type: 'llm.complete', output: { summary: 'A Page' } });
});

const errors = [
  [403, 'subscription_sharing_user_not_eligible', 'not_eligible'],
  [429, 'subscription_sharing_usage_limit_exceeded', 'usage_limit_exceeded'],
  [503, 'subscription_sharing_usage_unavailable', 'usage_unavailable'],
  [503, 'subscription_sharing_user_unavailable', 'usage_unavailable'],
  [400, 'subscription_sharing_unsupported_capability', 'provider_rejected'],
  [403, 'subscription_sharing_route_not_supported', 'provider_rejected'],
  [401, 'subscription_sharing_invalid_user', 'provider_rejected'],
  [403, 'chatpass_v2_scope_not_authorized', 'provider_rejected'],
  [403, 'chatpass_v2_invalid_authorization_context', 'provider_rejected'],
] as const;

for (const [status, code, expected] of errors) {
  test(`maps ${code} before and during a stream without retrying`, async () => {
    await signIn();
    const headers = { 'x-request-id': 'req_abc' };
    let requests = 0;
    respond = () => {
      requests++;
      return Response.json({ error: { code, message: 'untrusted detail', param: 'model' } }, { status, headers });
    };
    expect(await complete()).toMatchObject({ type: 'error', code: expected, requestId: 'req_abc' });
    expect(requests).toBe(1);
    respond = () => {
      requests++;
      return stream(frame('response.created'), frame('response.failed', { response: { error: { code, param: 'model' } } }));
    };
    expect(await complete()).toMatchObject({ type: 'error', code: expected });
    expect(requests).toBe(2);
  });
}

test('uses HTTP status for direct-admission failures without losing the request ID or exposing detail', async () => {
  await signIn();
  for (const [status, code] of [[401, 'provider_rejected'], [403, 'provider_rejected'], [503, 'usage_unavailable']] as const) {
    respond = () => Response.json({ detail: 'secret diagnostic' }, { status, headers: { 'x-request-id': 'req_admission' } });
    const result = await complete();
    expect(result).toMatchObject({ type: 'error', code, requestId: 'req_admission' });
    expect(JSON.stringify(result)).not.toContain('secret diagnostic');
  }
  expect(await handleMessage({ type: 'auth.status', id: 'status' }, ctx)).toMatchObject({ signedIn: true });
});

test('does not attempt inference without sign-in or a plan grant', async () => {
  respond = () => { throw new Error('Inference should not be called'); };
  expect(await complete()).toMatchObject({ type: 'error', code: 'not_signed_in' });
  mock.behavior.scope = 'openid profile email';
  await signIn();
  expect(await complete()).toMatchObject({ type: 'error', code: 'plan_usage_not_granted' });
});

test('temporary refresh failure backs off; a terminal grant failure requires sign-in', async () => {
  await signIn();
  now += 3_600_000;
  mock.behavior.refreshError = 'temporarily_unavailable';
  expect(await complete()).toMatchObject({ type: 'error', code: 'usage_unavailable', retryAfterMs: 5_000 });
  mock.behavior.refreshError = 'invalid_grant';
  expect(await complete()).toMatchObject({ type: 'error', code: 'not_signed_in' });
});

test('an explicit SSE error stops a partial stream even if a completion event follows', async () => {
  await signIn();
  respond = () => stream(delta('{"summary":"should not show"}'), frame('error', {
    code: 'subscription_sharing_usage_limit_exceeded',
  }), completed);
  expect(await complete()).toMatchObject({ type: 'error', code: 'usage_limit_exceeded' });
});

test('discards refusal, incomplete responses, and JSON that fails the schema', async () => {
  await signIn();
  for (const frames of [
    [frame('response.refusal.done'), delta('{"summary":"should not show"}'), completed],
    [delta('{"summary":"should not show"}'), frame('response.incomplete')],
    [delta('{"summary":42}'), completed],
  ]) {
    respond = () => stream(...frames);
    expect(await complete()).toMatchObject({ type: 'error', code: 'invalid_output' });
  }
});

for (const repairSucceeds of [true, false]) {
  test(`falls back on a text-format rejection and ${repairSucceeds ? 'repairs' : 'rejects'} bad JSON with one repair`, async () => {
    await signIn();
    const bodies: Record<string, unknown>[] = [];
    respond = async (request) => {
      const body = await request.json() as Record<string, unknown>;
      bodies.push(body);
      if (body.text) return Response.json({ error: {
        code: 'subscription_sharing_unsupported_capability', param: 'text.format',
      } }, { status: 400 });
      if (bodies.length === 3 && repairSucceeds) return stream(delta('{"summary":"Café design"}'), completed);
      return stream(delta('{"summary":42}'), completed);
    };
    expect(await complete()).toMatchObject(repairSucceeds
      ? { type: 'llm.complete', output: { summary: 'Café design' } }
      : { type: 'error', code: 'invalid_output' });
    expect(bodies).toHaveLength(3);
    expect(bodies[1]?.instructions).toContain(JSON.stringify(schema));
    expect(bodies[2]?.instructions).toContain('previous');
    expect(bodies.slice(1).every((body) => !('text' in body) && body.stream === true && body.store === false)).toBe(true);
  });
}
