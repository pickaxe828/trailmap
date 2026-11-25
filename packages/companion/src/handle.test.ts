import { expect, test } from 'bun:test';
import { handleMessage } from './handle';

test('answers companion.hello with its version', () => {
  expect(handleMessage({ type: 'companion.hello', id: 'a1' })).toEqual({
    type: 'companion.hello',
    id: 'a1',
    version: '0.0.0',
  });
});

test('rejects anything outside the fixed command set with a typed error', () => {
  const reply = handleMessage({ type: 'fetch.url', url: 'https://example.com' });
  expect(reply.type).toBe('error');
});
