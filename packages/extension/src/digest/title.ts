import type { Digest } from './types';
import { localTimeZone } from './week';

/** "Week of 16 Nov – 22 Nov 2026" or "Last 7 days to 28 Nov 2026". Days are in the user's zone, so the title matches their calendar. */
export function digestTitle({ kind, from, to }: Pick<Digest, 'kind' | 'from' | 'to'>, zone = localTimeZone()): string {
  const day = (ms: number, year = true) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).format(ms);
  return kind === 'week' ? `Week of ${day(from, false)} – ${day(to - 1)}` : `Last 7 days to ${day(to)}`;
}
