import { expect, test } from 'bun:test';
import { catchUpWeek, lastSevenDays, previousWeek, startOfLocalDay } from './week';

const at = (iso: string) => Date.parse(iso);

test('a local day starts at local midnight, in any zone', () => {
  expect(startOfLocalDay(2026, 10, 23, 'UTC')).toBe(at('2026-11-23T00:00:00Z'));
  expect(startOfLocalDay(2026, 10, 23, 'Asia/Tokyo')).toBe(at('2026-11-22T15:00:00Z'));
  expect(startOfLocalDay(2026, 10, 23, 'America/Los_Angeles')).toBe(at('2026-11-23T08:00:00Z'));
});

test('the previous week runs from last Monday 00:00 to this Monday 00:00 local time', () => {
  // Saturday 28 Nov 2026 12:00 UTC: this Monday is 23 Nov, so the previous week is 16–22 Nov.
  const week = previousWeek(at('2026-11-28T12:00:00Z'), 'UTC');
  expect(week).toEqual({ key: 'week-2026-11-16', from: at('2026-11-16T00:00:00Z'), to: at('2026-11-23T00:00:00Z') });
});

test('Monday 00:00 local is already the next week: the digest for the week that just ended is due', () => {
  expect(previousWeek(at('2026-11-23T00:00:00Z'), 'UTC').key).toBe('week-2026-11-16');
  expect(previousWeek(at('2026-11-22T23:59:59Z'), 'UTC').key).toBe('week-2026-11-09');
});

test('the Monday boundary follows the local zone, not UTC', () => {
  // 15:00 UTC on Sunday 22 Nov is already Monday 00:00 in Tokyo, but still Sunday 07:00 in Los Angeles.
  const instant = at('2026-11-22T15:00:00Z');
  expect(previousWeek(instant, 'Asia/Tokyo')).toEqual({ key: 'week-2026-11-16', from: at('2026-11-15T15:00:00Z'), to: at('2026-11-22T15:00:00Z') });
  expect(previousWeek(instant, 'America/Los_Angeles').key).toBe('week-2026-11-09');
});

test('a week with a daylight-saving change is 7 local days, not 168 hours', () => {
  // US clocks went back on 1 Nov 2026: the week of Mon 26 Oct is 169 hours long in Los Angeles.
  const week = previousWeek(at('2026-11-02T20:00:00Z'), 'America/Los_Angeles');
  expect(week.key).toBe('week-2026-10-26');
  expect(week.from).toBe(at('2026-10-26T07:00:00Z'));
  expect(week.to).toBe(at('2026-11-02T08:00:00Z'));
  expect(week.to - week.from).toBe(169 * 3_600_000);
});

test('a missed Monday catches up once, and never repeats a week', () => {
  const now = at('2026-11-26T09:00:00Z'); // Thursday
  expect(catchUpWeek(now, 'UTC', undefined)?.key).toBe('week-2026-11-16');
  expect(catchUpWeek(now, 'UTC', 'week-2026-11-09')?.key).toBe('week-2026-11-16'); // missed one Monday
  expect(catchUpWeek(now, 'UTC', 'week-2026-11-02')?.key).toBe('week-2026-11-16'); // missed several: only the latest week
  expect(catchUpWeek(now, 'UTC', 'week-2026-11-16')).toBeUndefined();
  expect(catchUpWeek(at('2026-11-30T00:00:01Z'), 'UTC', 'week-2026-11-16')?.key).toBe('week-2026-11-23');
});

test('on demand covers exactly the previous 7 days', () => {
  expect(lastSevenDays(at('2026-11-28T12:00:00Z'))).toEqual({ from: at('2026-11-21T12:00:00Z'), to: at('2026-11-28T12:00:00Z') });
});
