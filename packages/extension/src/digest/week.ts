/**
 * Week boundaries for the weekly digest. A week is Monday 00:00 to the next Monday 00:00 in the *user's* time zone, so it can be
 * 167, 168 or 169 hours long around a clock change. The zone is always an argument (an IANA name), never read from the process.
 */
export type WeekRange = { key: string; from: number; to: number };

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, zone: string) {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, format);
  }
  const value = Object.fromEntries(format.formatToParts(ms).map(({ type, value }) => [type, Number(value)])) as Record<string, number>;
  return { year: value.year!, month: value.month! - 1, day: value.day!, hour: value.hour!, minute: value.minute!, second: value.second! };
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function offset(ms: number, zone: string): number {
  const p = parts(ms, zone);
  return Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1_000) * 1_000;
}

/** The instant a calendar day (month 0–11) begins in the zone. */
export function startOfLocalDay(year: number, month: number, day: number, zone: string): number {
  const wall = Date.UTC(year, month, day);
  let instant = wall - offset(wall, zone);
  const corrected = wall - offset(instant, zone); // The offset differs when midnight is near a clock change.
  if (corrected !== instant) instant = corrected;
  return instant;
}

const two = (n: number) => String(n).padStart(2, '0');
const dateKey = (utc: number) => { const d = new Date(utc); return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`; };

/** The last complete Monday–Sunday week before the Monday on or before `now`. */
export function previousWeek(now: number, zone: string): WeekRange {
  const { year, month, day } = parts(now, zone);
  const today = Date.UTC(year, month, day);
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const thisMonday = new Date(today - sinceMonday * 86_400_000);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  return {
    key: `week-${dateKey(lastMonday.getTime())}`,
    from: startOfLocalDay(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate(), zone),
    to: startOfLocalDay(thisMonday.getUTCFullYear(), thisMonday.getUTCMonth(), thisMonday.getUTCDate(), zone),
  };
}

/**
 * The week to generate now, or nothing. `lastKey` is the newest week already handled: a Monday that was missed (browser closed)
 * is caught up once, with the most recent week only, and a handled week is never generated again.
 */
export function catchUpWeek(now: number, zone: string, lastKey: string | undefined): WeekRange | undefined {
  const week = previousWeek(now, zone);
  return !lastKey || week.key > lastKey ? week : undefined;
}

export const lastSevenDays = (now: number) => ({ from: now - 7 * 86_400_000, to: now });

/** `YYYY-MM-DD` of the local calendar day containing `ms`. */
export function localDateKey(ms: number, zone: string): string {
  const { year, month, day } = parts(ms, zone);
  return `${year}-${two(month + 1)}-${two(day)}`;
}
