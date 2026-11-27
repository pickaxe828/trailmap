import type { Visit } from '@trailmap/shared';

/** PLAN §4.2: a page is read when it had this much active time AND was scrolled this far, or on any highlight or copy. */
export const READ_ACTIVE_MS = 45_000;
export const READ_SCROLL_DEPTH = 0.3;
export const SKIM_ACTIVE_MS = 10_000;

export function scoreEngagement(activeMs: number, scrollDepth: number, interacted = false): Visit['engagement'] {
  if (interacted || (activeMs >= READ_ACTIVE_MS && scrollDepth >= READ_SCROLL_DEPTH)) return 'read';
  if (activeMs >= SKIM_ACTIVE_MS || scrollDepth > 0) return 'skimmed';
  return 'bounced';
}

/**
 * A video is read by watching it (playing, tab visible), not by scrolling, and a paused tab left open is not reading.
 * The thresholds match a page's active-time ones.
 */
export function scoreVideoEngagement(watchMs: number, interacted = false): Visit['engagement'] {
  if (interacted || watchMs >= READ_ACTIVE_MS) return 'read';
  return watchMs >= SKIM_ACTIVE_MS ? 'skimmed' : 'bounced';
}
