import { expect, test } from 'bun:test';
import { READ_ACTIVE_MS, READ_SCROLL_DEPTH, SKIM_ACTIVE_MS, scoreEngagement } from './engagement';

test('the read thresholds are 45 s active and 30% scrolled', () => {
  expect(READ_ACTIVE_MS).toBe(45_000);
  expect(READ_SCROLL_DEPTH).toBe(0.3);
  expect(SKIM_ACTIVE_MS).toBe(10_000);
});

test.each([
  [0, 0, false, 'bounced'],
  [9_999, 0, false, 'bounced'],
  [10_000, 0, false, 'skimmed'],
  [600_000, 0, false, 'skimmed'], // time alone is not reading
  [0, 0.01, false, 'skimmed'],
  [0, 1, false, 'skimmed'], // a quick scroll past is a skim
  [44_999, 1, false, 'skimmed'],
  [45_000, 0.29, false, 'skimmed'],
  [45_000, 0.3, false, 'read'],
  [120_000, 0.9, false, 'read'],
  [0, 0, true, 'read'],
] as const)('scores %i ms, %f scroll, interaction %s as %s', (activeMs, depth, interacted, expected) => {
  expect(scoreEngagement(activeMs, depth, interacted)).toBe(expected);
});
