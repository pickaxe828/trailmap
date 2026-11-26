import { expect, test } from 'bun:test';
import { planExpeditionClosures } from './close-rules';

const minute = 60_000;
const timing = { inactivityMs: 20 * minute, topicSwitchMs: 10 * minute };
const open = (id: string, lastActiveAt: number, startedAt = 0) => ({ id, startedAt, endedAt: null, lastActiveAt });

test('an Expedition closes after its own inactivity, with the next deadline set by the remaining Expeditions', () => {
  const result = planExpeditionClosures([
    open('inactive', 5 * minute),
    open('reading', 24 * minute),
    open('between', 18 * minute),
    { ...open('closed', 0), endedAt: minute },
  ], 25 * minute, timing);
  expect(result).toEqual({
    closures: [{ id: 'inactive', endedAt: 5 * minute }],
    nextDeadline: 38 * minute,
  });
});

test('a new Expedition closes only older Expeditions that meet the shorter topic-switch threshold', () => {
  expect(planExpeditionClosures([
    open('older', 2 * minute), open('still-reading', 11 * minute), open('new-topic', 12 * minute, 12 * minute),
  ], 12 * minute, timing, { newExpeditionId: 'new-topic' })).toEqual({
    closures: [{ id: 'older', endedAt: 2 * minute }], nextDeadline: 31 * minute,
  });
});
