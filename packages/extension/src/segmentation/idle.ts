import { IDLE_SECONDS } from '../capture/chrome-events';
import type { IdleState } from '../capture/events';
import { EXPEDITION_IDLE_SECONDS } from './config';

export function expeditionIdle(previous: number | null, state: IdleState, at: number) {
  if (state === 'active') {
    return { deadline: null, closeAt: previous !== null && previous <= at ? previous : null };
  }

  // Chrome reports ordinary idle after the capture threshold. A direct lock
  // has no known idle period yet, so start that countdown when it is observed.
  const delay = EXPEDITION_IDLE_SECONDS - (state === 'idle' ? IDLE_SECONDS : 0);
  const deadline = previous ?? at + delay * 1000;
  return { deadline, closeAt: deadline <= at ? deadline : null };
}
