export const REVIEW_QUESTIONS_MESSAGE = 'trailmap.review.questions';

export type ReviewQuestionsReply =
  /** `written` question cards were stored (0 when the model had nothing usable). */
  | { status: 'written'; written: number }
  /** The model-question setting is off: nothing was read and nothing was sent. */
  | { status: 'off' }
  /** None of the concepts may go to a model right now (paused, skipped, forgotten or not sendable): nothing was sent. */
  | { status: 'nothing' }
  | { status: 'error'; code: string };

/** Asks the background to write question cards for these concepts (from the Review page only). */
export async function requestReviewQuestions(conceptIds: string[]): Promise<ReviewQuestionsReply> {
  const reply: ReviewQuestionsReply | undefined = await chrome.runtime.sendMessage({ type: REVIEW_QUESTIONS_MESSAGE, conceptIds });
  return reply ?? { status: 'error', code: 'internal' };
}
