import { expect, test } from 'bun:test';
import { WatchClock } from './watch-video';

test('counts only the time between ticks during which the video was playing and the tab visible', () => {
  const clock = new WatchClock();
  clock.tick(0, true);
  clock.tick(1_000, true);
  clock.tick(2_000, false); // paused or hidden for the interval that ended here
  clock.tick(5_000, false);
  clock.tick(6_000, true);
  expect(clock.watchMs).toBe(2_000);
});

test('the first tick only starts the clock, and a long gap (a suspended tab) is not credited', () => {
  const clock = new WatchClock();
  clock.tick(10_000, true);
  expect(clock.watchMs).toBe(0);
  clock.tick(10_500, true);
  clock.tick(10_500 + 60_000, true);
  expect(clock.watchMs).toBe(500);
});

test('reset starts a fresh video', () => {
  const clock = new WatchClock();
  clock.tick(0, true);
  clock.tick(1_000, true);
  clock.reset();
  expect(clock.watchMs).toBe(0);
  clock.tick(2_000, true);
  expect(clock.watchMs).toBe(0);
});
