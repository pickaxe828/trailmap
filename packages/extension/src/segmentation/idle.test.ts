import { expect, test } from 'bun:test';
import { EXPEDITION_IDLE_SECONDS } from './config';
import { expeditionIdle } from './idle';

test('a brief idle interval clears the deadline while continued idle closes at 30 minutes', () => {
  const start = 60_000;
  const deadline = EXPEDITION_IDLE_SECONDS * 1000;
  const pending = expeditionIdle(null, 'idle', start);
  expect(pending).toEqual({ deadline, closeAt: null });
  expect(expeditionIdle(pending.deadline, 'active', start + 1000))
    .toEqual({ deadline: null, closeAt: null });
  expect(expeditionIdle(pending.deadline, 'idle', deadline))
    .toEqual({ deadline, closeAt: deadline });
});

test('a screen lock closes every open Expedition immediately', () => {
  expect(expeditionIdle(1_800_000, 'locked', 120_000)).toEqual({ deadline: 120_000, closeAt: 120_000 });
});

test('a deadline read after worker restart closes overdue Expeditions even as activity resumes', () => {
  const deadline = 1_800_000;
  expect(expeditionIdle(deadline, 'active', deadline + 100))
    .toEqual({ deadline: null, closeAt: deadline });
});
