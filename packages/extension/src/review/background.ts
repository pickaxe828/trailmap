import type { TrailmapDb } from '../db/db';
import type { RecordingSettings } from '../privacy/policy';
import { REVIEW_QUESTIONS_MESSAGE, type ReviewQuestionsReply } from './messages';
import { writeReviewQuestions } from './questions';
import { readReviewSettings } from './settings';

const REVIEW_PATH = '/review.html';

/** Writes optional question cards when the Review page asks. Nothing runs on a schedule: with review off, nothing runs at all. */
export function startReview(db: TrailmapDb, ready: Promise<unknown>, getSettings: () => RecordingSettings) {
  const page = chrome.runtime.getURL(REVIEW_PATH);
  chrome.runtime.onMessage.addListener((message, sender, respond: (reply: ReviewQuestionsReply) => void) => {
    if (message?.type !== REVIEW_QUESTIONS_MESSAGE || sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
        sender.url?.split(/[?#]/, 1)[0] !== page || !Array.isArray(message.conceptIds) ||
        !message.conceptIds.every((id: unknown) => typeof id === 'string')) return;
    void ready.then(() => writeReviewQuestions({ db, getSettings, readReviewSettings }, message.conceptIds))
      .then(respond).catch(() => respond({ status: 'error', code: 'internal' }));
    return true;
  });
}
