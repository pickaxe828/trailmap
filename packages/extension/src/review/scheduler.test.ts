import { describe, expect, test } from 'bun:test';
import { DAY_MS, gradeCard, newReviewState, type ReviewRating } from './scheduler';

// Reference values: the FSRS-6 default parameters published by open-spaced-repetition
// (https://github.com/open-spaced-repetition/ts-fsrs, `default_w`): w0..w3 = 0.2120, 1.2931, 2.3065, 8.2956 are the
// initial stabilities after a first Again / Hard / Good / Easy, w4 = 6.4133 the initial difficulty for Good...
const T0 = Date.UTC(2026, 0, 1);

describe('first review of a new card', () => {
  test.each([
    ['again', 0.212], ['hard', 1.2931], ['good', 2.3065], ['easy', 8.2956],
  ] as [ReviewRating, number][])('%s gives the published initial stability %d', (rating, stability) => {
    const { state } = gradeCard(newReviewState(T0), rating, T0);
    expect(state.stability).toBeCloseTo(stability, 4);
  });

  test('a first Good is due in two days and a first Easy in eight (interval = stability at 90% retention)', () => {
    expect(gradeCard(newReviewState(T0), 'good', T0).state.due).toBe(T0 + 2 * DAY_MS);
    expect(gradeCard(newReviewState(T0), 'easy', T0).state.due).toBe(T0 + 8 * DAY_MS);
  });

  test('an Again comes back in the ten-minute learning step, a Hard after fifteen', () => {
    expect(gradeCard(newReviewState(T0), 'again', T0).state.due).toBe(T0 + 10 * 60_000);
    expect(gradeCard(newReviewState(T0), 'hard', T0).state.due).toBe(T0 + 15 * 60_000);
  });

  test('a first Good then a Good three days later reproduces the library\'s stability of 13.8269', () => {
    const first = gradeCard(newReviewState(T0), 'good', T0).state;
    const second = gradeCard(first, 'good', T0 + 3 * DAY_MS).state;
    expect(second.stability).toBeCloseTo(13.8269, 3);
    expect(second.due).toBe(T0 + 3 * DAY_MS + 14 * DAY_MS);
    expect(second.reps).toBe(2);
  });
});

describe('grading', () => {
  test('is deterministic: no fuzz, so the same grades give the same dates', () => {
    const a = gradeCard(gradeCard(newReviewState(T0), 'good', T0).state, 'hard', T0 + 2 * DAY_MS);
    const b = gradeCard(gradeCard(newReviewState(T0), 'good', T0).state, 'hard', T0 + 2 * DAY_MS);
    expect(a).toEqual(b);
  });

  test('a lapse (Again on a card that was graduating) counts and shortens the next interval', () => {
    const learned = gradeCard(gradeCard(newReviewState(T0), 'good', T0).state, 'good', T0 + 2 * DAY_MS).state;
    const lapsed = gradeCard(learned, 'again', learned.due).state;
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.stability).toBeLessThan(learned.stability);
  });

  test('easier grades never schedule sooner than harder ones', () => {
    const base = gradeCard(newReviewState(T0), 'good', T0).state;
    const at = base.due;
    const due = (rating: ReviewRating) => gradeCard(base, rating, at).state.due;
    expect(due('again')).toBeLessThanOrEqual(due('hard'));
    expect(due('hard')).toBeLessThanOrEqual(due('good'));
    expect(due('good')).toBeLessThanOrEqual(due('easy'));
  });

  test('the log entry records the grade, the time and the due date it produced', () => {
    const { log, state } = gradeCard(newReviewState(T0), 'good', T0);
    expect(log).toMatchObject({ rating: 'good', at: T0, due: state.due, stateBefore: 'new' });
  });

  test('the stored state is plain numbers (no Date objects) so it survives IndexedDB and JSON', () => {
    const { state } = gradeCard(newReviewState(T0), 'good', T0);
    expect(Object.values(state).every((value) => typeof value === 'number' || typeof value === 'string' || value === undefined)).toBe(true);
  });
});
