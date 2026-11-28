import type { ReviewLogEntry, ReviewState } from './scheduler';

/**
 * One Concept's review card: its scheduling state, plus the model-written question when that opt-in is on. A row exists only
 * once a card has been graded or given a question; every other eligible Concept is a new card without a row.
 * `question.forGloss` is the gloss the question was written for, so a changed gloss never shows a stale question.
 */
export type ReviewCard = ReviewState & {
  conceptId: string;
  question?: { text: string; forGloss: string; at: number };
};

export type ReviewLog = ReviewLogEntry & { id: string; conceptId: string };

/** The user starred this Concept to be reviewed even if it is not learned yet. */
export type ConceptStar = { conceptId: string; at: number };
