import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ModelDispatch } from '@trailmap/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMessage, type CompanionContext } from '../handle';
import { FileSecretStore } from '../secrets';

const fakeKey = 'fixture-only-anthropic-key';
const logs: string[] = [];
let dir: string;
let ctx: CompanionContext;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailmap-llm-'));
  logs.length = 0;
  ctx = { env: {}, secrets: new FileSecretStore(join(dir, 'secrets.json')), log: (line) => logs.push(line) };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const send = (type: string, payload = {}) => handleMessage({ type, id: 'test', ...payload }, ctx);
const saveKey = () => send('keys.set', { provider: 'anthropic', key: fakeKey });

test('saving an Anthropic key returns only presence, including after the companion restarts', async () => {
  expect(await saveKey()).toEqual({ type: 'keys.set', id: 'test', keySet: true });
  ctx = { ...ctx, secrets: new FileSecretStore(join(dir, 'secrets.json')) };
  expect(await send('keys.status', { provider: 'anthropic' })).toEqual({ type: 'keys.status', id: 'test', keySet: true });
  expect(logs).toEqual([]);
});

const schema = {
  type: 'object', properties: { takeaways: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 } },
  required: ['takeaways'], additionalProperties: false,
};
const completion = (provider: string, payload = {}) => send('llm.complete', {
  provider, task: 'page_enrichment', input: 'This Page is about CRDTs.', instructions: 'Extract takeaways.',
  schema, schemaName: 'page_enrichment', ...payload,
});
const validText = '{"takeaways":["A CRDT can merge concurrent edits.","Tombstones mark deletions."]}';

async function withApi(provider: 'ANTHROPIC' | 'OLLAMA', fetch: (request: Request) => Response | Promise<Response>, run: () => Promise<void>) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch });
  ctx.env[`TRAILMAP_${provider}_BASE_URL`] = server.url.origin + (provider === 'ANTHROPIC' ? '/v1' : '');
  try { await run(); } finally { await server.stop(true); }
}

const anthropicReply = (text: string, reason = 'end_turn') => Response.json({ stop_reason: reason, content: [
  { type: 'thinking', thinking: 'not output' }, { type: 'text', text },
] });

test('Anthropic sends audited structured output with task defaults and no sampling parameters', async () => {
  await saveKey();
  const sent: { path: string; key: string | null; version: string | null; body: unknown }[] = [];
  const audits: ModelDispatch[] = [];
  ctx.authorizeDispatch = async (_id, dispatch) => { audits.push(dispatch); return true; };
  const auditId = crypto.randomUUID();
  await withApi('ANTHROPIC', async (request) => {
    expect(audits).toHaveLength(sent.length + 1);
    sent.push({ path: new URL(request.url).pathname, key: request.headers.get('x-api-key'),
      version: request.headers.get('anthropic-version'), body: await request.json() });
    return anthropicReply(validText);
  }, async () => {
    expect(await completion('anthropic', { auditId })).toMatchObject({ type: 'llm.complete', output: JSON.parse(validText) });
    expect(await completion('anthropic', { auditId, task: 'field_notes' })).toMatchObject({ type: 'llm.complete' });
  });
  const messages: ModelDispatch['input'] = [{ role: 'user', content: 'This Page is about CRDTs.' }];
  expect(sent[0]).toEqual({ path: '/v1/messages', key: fakeKey, version: '2026-10-21', body: {
    model: 'claude-haiku-5-5', max_tokens: 4096, system: 'Extract takeaways.', messages,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: {
      type: 'object', properties: { takeaways: { type: 'array', items: { type: 'string' } } },
      required: ['takeaways'], additionalProperties: false,
    } } },
  } });
  expect(sent[1]?.body).toMatchObject({ model: 'claude-sonnet-5-5' });
  expect(audits[0]).toEqual({ provider: 'Anthropic', model: 'claude-haiku-5-5', instructions: 'Extract takeaways.', input: messages });
});

test('Ollama validates and retries once, auditing each actual request with an explicit context window', async () => {
  const audits: ModelDispatch[] = [];
  const chats: unknown[] = [];
  ctx.authorizeDispatch = async (_id, dispatch) => { audits.push(dispatch); return true; };
  await withApi('OLLAMA', async (request) => {
    if (new URL(request.url).pathname === '/api/tags') {
      return Response.json({ models: [{ name: 'local:latest' }, { name: 'remote:latest', remote_host: 'https://fixture.invalid' }] });
    }
    expect(new URL(request.url).pathname).toBe('/api/chat');
    expect(audits).toHaveLength(chats.length + 1);
    const body = await request.json();
    chats.push(body);
    expect(body).toMatchObject({ model: 'local:latest', format: schema, stream: false, options: { num_ctx: 32768 } });
    expect(body.messages).toEqual([{ role: 'system', content: audits.at(-1)?.instructions }, ...audits.at(-1)!.input]);
    return Response.json({ done: true, done_reason: 'stop', message: { content: chats.length === 1 ? '{"takeaways":[]}' : validText } });
  }, async () => {
    expect(await completion('ollama', { auditId: crypto.randomUUID() })).toMatchObject({ type: 'llm.complete', output: JSON.parse(validText) });
    expect(await completion('ollama', { model: 'remote:latest' })).toMatchObject({ type: 'error', code: 'model_not_found' });
  });
  expect(chats).toHaveLength(2);
  expect(audits[1]).toMatchObject({ provider: 'Ollama', model: 'local:latest' });
});

test('isolates unavailable catalogs and maps upstream errors without echoing provider error text', async () => {
  await saveKey();
  let response: () => Response;
  await withApi('OLLAMA', () => Response.json({ models: [{ name: 'local:latest' }] }), async () => {
    await withApi('ANTHROPIC', () => response(), async () => {
      response = () => Response.json({ error: { message: fakeKey } }, { status: 401 });
      const catalog = await send('llm.models');
      expect(catalog).toMatchObject({ models: [{ provider: 'ollama', slug: 'local:latest' }], providers: [
        { provider: 'chatgpt', error: 'not_signed_in' }, { provider: 'anthropic', error: 'invalid_api_key' }, { provider: 'ollama' },
      ] });
      const invalidKey = await completion('anthropic');
      expect(invalidKey).toMatchObject({ type: 'error', code: 'invalid_api_key' });
      expect(logs).toContain('llm.complete failed provider=anthropic code=invalid_api_key reason=http_status status=401');
      expect(JSON.stringify([catalog, invalidKey, logs])).not.toContain(fakeKey);
      response = () => Response.json({}, { status: 429, headers: { 'retry-after': '12' } });
      expect(await completion('anthropic')).toMatchObject({ type: 'error', code: 'provider_rate_limited', retryAfterMs: 12000 });
      response = () => Response.json({ error: { details: { error_code: 'enforced_spend_limit_reached' } } }, { status: 429 });
      expect(await completion('anthropic')).toMatchObject({ type: 'error', code: 'provider_quota_exceeded' });
      response = () => anthropicReply(validText, 'refusal');
      expect(await completion('anthropic')).toMatchObject({ type: 'error', code: 'invalid_output' });
      response = () => anthropicReply('{"takeaways":[]}');
      expect(await completion('anthropic')).toMatchObject({ type: 'error', code: 'invalid_output' });
    });
  });
  expect(await completion('ollama')).toMatchObject({ type: 'error', code: 'provider_unreachable' });
});

test('an unsaved Anthropic key is distinct from a rejected key', async () => {
  await withApi('OLLAMA', () => Response.json({ models: [] }), async () => {
    expect(await send('keys.status', { provider: 'anthropic' })).toMatchObject({ keySet: false });
    expect(await send('llm.models')).toMatchObject({ providers: [
      { provider: 'chatgpt', error: 'not_signed_in' }, { provider: 'anthropic', error: 'api_key_missing' }, { provider: 'ollama' },
    ] });
    expect(await completion('anthropic')).toMatchObject({ type: 'error', code: 'api_key_missing' });
  });
});

test('Ollama reports when a local model disappears or the server rate limits inference', async () => {
  let status = 404;
  await withApi('OLLAMA', (request) => {
    if (new URL(request.url).pathname === '/api/tags') return Response.json({ models: [{ name: 'local:latest' }] });
    return Response.json({ error: 'Fixture error details' }, { status, headers: { 'retry-after': '12' } });
  }, async () => {
    expect(await completion('ollama', { model: 'local:latest' })).toMatchObject({ type: 'error', code: 'model_not_found' });
    status = 429;
    const limited = await completion('ollama', { model: 'local:latest' });
    expect(limited).toMatchObject({ type: 'error', code: 'provider_rate_limited', retryAfterMs: 12000 });
    expect(JSON.stringify(limited)).not.toContain('Fixture error details');
  });
});

test('neither new provider sends Page text if the audit guard denies dispatch', async () => {
  await saveKey();
  const auditId = crypto.randomUUID();
  ctx.authorizeDispatch = async () => false;
  await withApi('ANTHROPIC', () => { throw new Error('unexpected inference'); }, async () => {
    expect(await completion('anthropic', { auditId })).toMatchObject({ type: 'error', code: 'dispatch_cancelled' });
  });
  await withApi('OLLAMA', (req) => {
    if (new URL(req.url).pathname === '/api/tags') return Response.json({ models: [{ name: 'local:latest' }] });
    throw new Error('unexpected inference');
  }, async () => {
    expect(await completion('ollama', { auditId })).toMatchObject({ type: 'error', code: 'dispatch_cancelled' });
  });
});
