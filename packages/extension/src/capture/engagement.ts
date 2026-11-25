import type { Visit } from '@trailmap/shared';

export function scoreEngagement(activeMs: number, scrollDepth: number, interacted = false): Visit['engagement'] {
  if (interacted || activeMs > 60_000 || scrollDepth > 0.5) return 'read';
  if (activeMs >= 10_000 || scrollDepth > 0) return 'skimmed';
  return 'bounced';
}
