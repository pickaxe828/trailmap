import { describe, expect, test } from 'bun:test';
import { formatActiveTime } from './format';

describe('formatActiveTime', () => {
  test.each([
    [0, '0s'],
    [999, '0s'],
    [12_400, '12s'],
    [60_000, '1m'],
    [185_000, '3m 5s'],
    [3_600_000, '1h'],
    [5_400_000, '1h 30m'],
  ])('%d ms reads as %s', (ms, expected) => {
    expect(formatActiveTime(ms)).toBe(expected);
  });
});
