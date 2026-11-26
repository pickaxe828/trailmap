import type { Expedition } from '@trailmap/shared';

export type ExpeditionActivity = Pick<Expedition, 'id' | 'startedAt' | 'endedAt'> & { lastActiveAt: number };
export type ExpeditionTiming = { inactivityMs: number; topicSwitchMs: number };

type Trigger = { newExpeditionId?: string; sessionStartedAt?: number };

export function planExpeditionClosures(expeditions: readonly ExpeditionActivity[], now: number, timing: ExpeditionTiming, trigger: Trigger = {}) {
  const closures: { id: string; endedAt: number }[] = [];
  let nextDeadline: number | null = null;
  for (const { id, startedAt, endedAt, lastActiveAt } of expeditions) {
    if (endedAt !== null || startedAt > now) continue;
    const deadline = lastActiveAt + timing.inactivityMs;
    const switched = trigger.newExpeditionId !== undefined && id !== trigger.newExpeditionId &&
      now - lastActiveAt >= timing.topicSwitchMs;
    const previousSession = trigger.sessionStartedAt !== undefined && startedAt < trigger.sessionStartedAt;
    if (deadline <= now || switched || previousSession) closures.push({ id, endedAt: lastActiveAt });
    else if (nextDeadline === null || deadline < nextDeadline) nextDeadline = deadline;
  }
  return { closures, nextDeadline };
}
