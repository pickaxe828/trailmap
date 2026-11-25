import { expect, test } from 'bun:test';
import { canonicalizeUrl } from './canonical';

test('a relative canonical link supplies the Page URL and keeps meaningful parameters', () => {
  expect(canonicalizeUrl(
    'https://learn.test/archive/entry?utm_source=feed',
    '../article?topic=crdt&UTM_medium=email&fbclid=1&gclid=2&session_id=3&PHPSESSID=4#example',
  )).toBe('https://learn.test/article?topic=crdt');
});

test('an unusable canonical link falls back to the cleaned Visit URL', () => {
  expect(canonicalizeUrl('https://learn.test/article?sid=123&chapter=2#section', 'javascript:void(0)'))
    .toBe('https://learn.test/article?chapter=2');
});

test('Kagi search session parameters are removed from the canonical URL', () => {
  expect(canonicalizeUrl('https://kagi.com/search?token=example&q=logical+clocks'))
    .toBe('https://kagi.com/search?q=logical+clocks');
});
