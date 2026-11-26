import { IDLE_SECONDS } from '../capture/chrome-events';
import type { IdleState } from '../capture/events';
import { EXPEDITION_IDLE_SECONDS } from './config';

export function expeditionIdle(previous: number | null, state: IdleState, at: number) {
  if (state === 'active') {
    return { deadline: null, closeAt: previous !== null && previous <= at ? previous : null };
  }

  if (state === 'locked') {
    const closeAt = Math.min(previous ?? at, at);
    return { deadline: closeAt, closeAt };
  }

  // Chrome reports ordinary idle after the capture threshold has already elapsed.
  const deadline = previous ?? at + (EXPEDITION_IDLE_SECONDS - IDLE_SECONDS) * 1000;
  return { deadline, closeAt: deadline <= at ? deadline : null };
}
