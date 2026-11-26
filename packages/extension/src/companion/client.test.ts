import { beforeEach, expect, test } from 'bun:test';
import { chunkMessage } from '@trailmap/shared';
import { CompanionClient, CompanionRequestError, type CompanionStatus } from './client';
import { FakeScheduler, FakeTransport } from './testing';

const NOT_FOUND = 'Specified native messaging host not found.';
let transport: FakeTransport;
let scheduler: FakeScheduler;
let client: CompanionClient;
let statuses: CompanionStatus[];

beforeEach(() => {
  transport = new FakeTransport();
  scheduler = new FakeScheduler();
  let n = 0;
  client = new CompanionClient({ transport, scheduler, newId: () => `id${++n}` });
  statuses = [];
  client.subscribe((s) => statuses.push(s));
});

/** Gets the client through a successful hello. */
function connect() {
  client.start();
  transport.latest.receive({ type: 'companion.hello', id: transport.latest.lastId, version: '9.9.9' });
}

test('starts connecting, says hello, and is connected once the companion answers', () => {
  client.start();
  expect(client.status).toEqual({ state: 'connecting' });
  expect(transport.latest.sent).toEqual([{ type: 'companion.hello', id: 'id1' }]);

  transport.latest.receive({ type: 'companion.hello', id: 'id1', version: '9.9.9' });
  expect(client.status).toEqual({ state: 'connected', version: '9.9.9' });
  expect(statuses.map((s) => s.state)).toEqual(['connecting', 'connected']);
});

test('audited inference never sends Page text to an older companion', async () => {
  connect();
  await expect(client.request('llm.complete', {
    task: 'page_enrichment', auditId: crypto.randomUUID(), input: 'Page text', instructions: 'Summarize.',
    schema: {}, schemaName: 'page_enrichment',
  })).rejects.toMatchObject({ code: 'not_connected' });
  expect(transport.latest.sent).toEqual([{ type: 'companion.hello', id: 'id1' }]);
});

test('a companion that predates provider selection cannot silently send Ollama prompts to ChatGPT', async () => {
  client.start();
  transport.latest.receive({ type: 'companion.hello', id: 'id1', version: '9.9.9', modelAudit: true });
  const reply = client.request('llm.complete', {
    provider: 'ollama', task: 'page_enrichment', auditId: crypto.randomUUID(), input: 'Page text', instructions: 'Summarize.',
    schema: {}, schemaName: 'page_enrichment',
  });
  client.stop(); // Settle an incorrectly forwarded request too, so this test does not wait for a timer.
  await expect(reply).rejects.toMatchObject({ code: 'not_connected' });
  expect(transport.latest.sent).toEqual([{ type: 'companion.hello', id: 'id1' }]);
});

test('request() sends a typed request and resolves with the matching response', async () => {
  connect();
  const reply = client.request('companion.hello', {});
  const id = transport.latest.lastId;
  transport.latest.receive({ type: 'companion.hello', id: 'unrelated', version: 'x' }); // someone else's id: ignored
  transport.latest.receive({ type: 'companion.hello', id, version: '1.0.0' });
  expect(await reply).toEqual({ type: 'companion.hello', id, version: '1.0.0' });
});

test('a typed error from the companion rejects the request with its code', async () => {
  connect();
  const reply = client.request('companion.hello', {});
  transport.latest.receive({ type: 'error', id: transport.latest.lastId, code: 'internal', message: 'nope' });
  await expect(reply).rejects.toMatchObject({ name: 'CompanionRequestError', code: 'internal' });
});

test('a model error preserves the retry hint and upstream request ID for callers', async () => {
  connect();
  const reply = client.request('llm.models', {});
  transport.latest.receive({ type: 'error', id: transport.latest.lastId, code: 'usage_unavailable',
    message: 'Unavailable', retryAfterMs: 5_000, requestId: 'req_fixture' });
  await expect(reply).rejects.toMatchObject({ code: 'usage_unavailable', details: { retryAfterMs: 5_000, requestId: 'req_fixture' } });
});

test('request() while not connected fails fast; while connecting it waits for the handshake', async () => {
  await expect(client.request('companion.hello', {})).rejects.toMatchObject({ code: 'not_connected' });

  client.start();
  const waiting = client.request('companion.hello', {});
  transport.latest.receive({ type: 'companion.hello', id: 'id1', version: '1' });
  await Bun.sleep(0);
  const id = transport.latest.lastId;
  expect(id).not.toBe('id1');
  transport.latest.receive({ type: 'companion.hello', id, version: '1' });
  expect((await waiting).type).toBe('companion.hello');
});

test('a missing host is "not-installed", and the client keeps retrying with growing delays until it appears', () => {
  client.start();
  transport.latest.disconnect(NOT_FOUND);
  expect(client.status).toEqual({ state: 'not-installed' });

  const retryAfter = (ms: number) => {
    const before = transport.connections.length;
    scheduler.advance(ms - 1);
    expect(transport.connections.length).toBe(before);
    scheduler.advance(1);
    expect(transport.connections.length).toBe(before + 1);
    transport.latest.disconnect(NOT_FOUND);
  };
  [1000, 2000, 4000, 8000, 16000, 30000, 30000].forEach(retryAfter); // capped at 30 s

  // The companion gets installed: the next attempt connects and the status flips.
  scheduler.advance(30_000);
  transport.latest.receive({ type: 'companion.hello', id: transport.latest.lastId, version: '1' });
  expect(client.status.state).toBe('connected');
});

test('forbidden origin also reads as not-installed; other disconnects are "disconnected" with the browser reason', () => {
  client.start();
  transport.latest.disconnect('Access to the specified native messaging host is forbidden.');
  expect(client.status).toEqual({ state: 'not-installed' });
  scheduler.advance(1000);
  transport.latest.disconnect('Native host has exited.');
  expect(client.status).toEqual({ state: 'disconnected', reason: 'Native host has exited.' });
});

test('after a crash the client reconnects quickly, and a good handshake resets the backoff', () => {
  connect();
  transport.latest.disconnect('Native host has exited.');
  expect(client.status.state).toBe('disconnected');
  scheduler.advance(1000);
  transport.latest.receive({ type: 'companion.hello', id: transport.latest.lastId, version: '1' });
  expect(client.status.state).toBe('connected');
  transport.latest.disconnect('Native host has exited.');
  const count = transport.connections.length;
  scheduler.advance(1000);
  expect(transport.connections.length).toBe(count + 1);
});

test('a host that connects but never answers hello is dropped after a timeout and retried', () => {
  client.start();
  const first = transport.latest;
  scheduler.advance(5000);
  expect(first.closed).toBe(true);
  expect(client.status.state).toBe('disconnected');
  scheduler.advance(1000);
  expect(transport.connections.length).toBe(2);
});

test('pending requests fail when the companion goes away', async () => {
  connect();
  const reply = client.request('companion.hello', {});
  transport.latest.disconnect('Native host has exited.');
  await expect(reply).rejects.toMatchObject({ code: 'not_connected' });
});

test('a request the companion never answers times out', async () => {
  connect();
  const reply = client.request('companion.hello', {});
  scheduler.advance(30_000);
  await expect(reply).rejects.toBeInstanceOf(CompanionRequestError);
  await expect(reply).rejects.toMatchObject({ code: 'timeout' });
});

test('reconnectNow() retries immediately and resets the backoff; it does nothing while connected', () => {
  client.start();
  transport.latest.disconnect(NOT_FOUND);
  scheduler.advance(1000);
  transport.latest.disconnect(NOT_FOUND); // backoff is now 2 s
  const count = transport.connections.length;
  client.reconnectNow();
  expect(transport.connections.length).toBe(count + 1);

  transport.latest.receive({ type: 'companion.hello', id: transport.latest.lastId, version: '1' });
  client.reconnectNow();
  expect(transport.connections.length).toBe(count + 1);
});

test('pushed events reach subscribers; unknown or invalid frames are ignored', () => {
  connect();
  const events: unknown[] = [];
  client.onEvent((e) => events.push(e));
  transport.latest.receive({ type: 'event', name: 'companion.fatal', message: 'boom' });
  transport.latest.receive({ type: 'event', name: 'made-up' });
  transport.latest.receive('garbage');
  transport.latest.receive(null);
  expect(events).toEqual([{ type: 'event', name: 'companion.fatal', message: 'boom' }]);
  expect(client.status.state).toBe('connected');
});

test('a response paged into chunks is reassembled', async () => {
  connect();
  const reply = client.request('companion.hello', {});
  const id = transport.latest.lastId;
  for (const frame of chunkMessage({ type: 'companion.hello', id, version: 'v'.repeat(5000) }, 800).reverse()) {
    transport.latest.receive(frame); // arrival order must not matter
  }
  expect(await reply).toMatchObject({ id, version: 'v'.repeat(5000) });
});

test('stop() closes the port and stops retrying', () => {
  connect();
  const port = transport.latest;
  client.stop();
  expect(port.closed).toBe(true);
  port.disconnect('Native host has exited.');
  scheduler.advance(60_000);
  expect(transport.connections.length).toBe(1);
});
