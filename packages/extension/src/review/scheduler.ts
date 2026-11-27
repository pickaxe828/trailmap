import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

export const DAY_MS = 86_400_000;
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';
export const REVIEW_RATINGS: readonly ReviewRating[] = ['again', 'hard', 'good', 'easy'];
type StateName = 'new' | 'learning' | 'review' | 'relearning';

/**
 * The scheduling state of one Concept card (FSRS-6 through `ts-fsrs`), as plain numbers. `due` and `lastReview` are epoch ms.
 * `learningSteps` is part of the library's card, kept so a stored state can be handed back to it unchanged.
 */
export type ReviewState = {
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  state: StateName;
  lastReview?: number;
};

/** What one grade did, for the review log. */
export type ReviewLogEntry = { rating: ReviewRating; at: number; stateBefore: StateName; due: number; stability: number; difficulty: number };

// No fuzz, so grades are reproducible. One ten-minute step: an Again or Hard comes back within the session, a Good or Easy
// is scheduled in days from the first grade.
export const LEARNING_STEP_MS = 10 * 60_000;
const scheduler = fsrs(generatorParameters({ enable_fuzz: false, learning_steps: ['10m'], relearning_steps: ['10m'] }));

const names: StateName[] = ['new', 'learning', 'review', 'relearning'];
const ratings = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const satisfies Record<ReviewRating, Grade>;

const toCard = (s: ReviewState): Card => ({
  due: new Date(s.due), stability: s.stability, difficulty: s.difficulty, scheduled_days: s.scheduledDays, reps: s.reps,
  lapses: s.lapses, learning_steps: s.learningSteps, state: names.indexOf(s.state) as State,
  last_review: s.lastReview === undefined ? undefined : new Date(s.lastReview),
});

const fromCard = (card: Card): ReviewState => ({
  due: card.due.getTime(), stability: card.stability, difficulty: card.difficulty, scheduledDays: card.scheduled_days,
  reps: card.reps, lapses: card.lapses, learningSteps: card.learning_steps, state: names[card.state] ?? 'new',
  ...(card.last_review ? { lastReview: card.last_review.getTime() } : {}),
});

/** A card nobody has graded yet; it is due now. */
export const newReviewState = (now: number): ReviewState => fromCard(createEmptyCard(new Date(now)));

export function gradeCard(before: ReviewState, rating: ReviewRating, now: number): { state: ReviewState; log: ReviewLogEntry } {
  const { card } = scheduler.next(toCard(before), new Date(now), ratings[rating]);
  const state = fromCard(card);
  return { state, log: { rating, at: now, stateBefore: before.state, due: state.due, stability: state.stability, difficulty: state.difficulty } };
}
