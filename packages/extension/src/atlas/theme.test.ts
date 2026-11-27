import { expect, test } from 'bun:test';
import { blend } from './theme';

test('a faded concept colour is the community colour blended toward the card, so the hue stays', () => {
  expect(blend('#ff0000', '#ffffff', 0.4)).toBe('#ff9999');
  expect(blend('#102030', '#102030', 0.4)).toBe('#102030');
  expect(blend('#000000', '#ffffff', 1)).toBe('#000000');
});
