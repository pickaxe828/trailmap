import { expect, test } from 'bun:test';
import { CompanionEvent, CompanionRequest, CompanionResponse, NATIVE_HOST_NAME } from './messages';

test('the native host name is the one the install manifest uses', () => {
  expect(NATIVE_HOST_NAME).toBe('com.trailmap.companion');
});

test('a hello request needs an id, and unknown verbs are rejected', () => {
  expect(CompanionRequest.safeParse({ type: 'companion.hello', id: 'r1' }).success).toBe(true);
  expect(CompanionRequest.safeParse({ type: 'companion.hello' }).success).toBe(false);
  expect(CompanionRequest.safeParse({ type: 'fetch.url', id: 'r1', url: 'https://example.com' }).success).toBe(false);
});

test('responses can be hello answers or typed errors; errors need a known code', () => {
  expect(CompanionResponse.safeParse({ type: 'companion.hello', id: 'r1', version: '1.2.3' }).success).toBe(true);
  expect(
    CompanionResponse.safeParse({ type: 'error', id: null, code: 'invalid_json', message: 'bad frame' }).success,
  ).toBe(true);
  expect(CompanionResponse.safeParse({ type: 'error', id: 'r1', code: 'whoops', message: 'x' }).success).toBe(false);
});

test('the companion can push events', () => {
  expect(CompanionEvent.safeParse({ type: 'event', name: 'companion.ready', version: '1.2.3' }).success).toBe(true);
  expect(CompanionEvent.safeParse({ type: 'event', name: 'companion.fatal', message: 'boom' }).success).toBe(true);
  expect(CompanionEvent.safeParse({ type: 'event', name: 'nope' }).success).toBe(false);
});
