import { expect, test } from 'bun:test';
import { scoreEngagement } from './engagement';

test.each([
  [0, 0, false, 'bounced'],
  [9_999, 0, false, 'bounced'],
  [10_000, 0, false, 'skimmed'],
  [60_000, 0, false, 'skimmed'],
  [60_001, 0, false, 'read'],
  [0, 0.01, false, 'skimmed'],
  [0, 0.5, false, 'skimmed'],
  [0, 0.5001, false, 'read'],
  [0, 0, true, 'read'],
] as const)('scores %i ms, %f scroll, interaction %s as %s', (activeMs, depth, interacted, expected) => {
  expect(scoreEngagement(activeMs, depth, interacted)).toBe(expected);
});
