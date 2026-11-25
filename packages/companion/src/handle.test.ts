import { expect, test } from 'bun:test';
import { COMPANION_VERSION, handleFrame, handleMessage, type CompanionContext } from './handle';

const ctx: CompanionContext = {
  env: {},
  secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
  log: () => {},
};

test('answers companion.hello with its version', async () => {
  expect(await handleMessage({ type: 'companion.hello', id: 'a1' }, ctx)).toEqual({
    type: 'companion.hello',
    id: 'a1',
    version: COMPANION_VERSION,
  });
});

test('rejects anything outside the fixed command set with a typed unknown_message error', async () => {
  expect(await handleMessage({ type: 'fetch.url', id: 'z', url: 'https://example.com' }, ctx)).toEqual({
    type: 'error',
    id: 'z',
    code: 'unknown_message',
    message: 'Unknown message type',
  });
  expect((await handleMessage('hi', ctx)).type).toBe('error');
  expect(await handleMessage(null, ctx)).toMatchObject({ code: 'unknown_message', id: null });
});

test('a known verb with a malformed payload gets invalid_message, keeping the request id when there is one', async () => {
  expect(await handleMessage({ type: 'companion.hello', id: 7 }, ctx)).toMatchObject({
    type: 'error',
    code: 'invalid_message',
    id: null,
  });
});

test('a frame that is not JSON gets invalid_json and does not throw', async () => {
  expect(await handleFrame('{not json', ctx)).toMatchObject({ type: 'error', code: 'invalid_json', id: null });
});

test('a handler that throws becomes an internal error without leaking its message', async () => {
  const broken: CompanionContext = {
    ...ctx,
    handlers: { 'companion.hello': () => Promise.reject(new Error('token sk-secret-123')) },
  };
  const reply = await handleMessage({ type: 'companion.hello', id: 'a1' }, broken);
  expect(reply).toEqual({ type: 'error', id: 'a1', code: 'internal', message: 'The companion failed to handle this message' });
});
