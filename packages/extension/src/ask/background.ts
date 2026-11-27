import type { TrailmapDb } from '../db/db';
import { CompanionRequestError } from '../companion/client';
import type { RecordingSettings } from '../privacy/policy';
import { ask } from './ask';
import { ASK_MESSAGE, type AskReply } from './messages';

const JOURNAL_PATH = '/journal.html';
const CANDIDATES = 60;
const SEMANTIC_BUDGET_MS = 10_000;

/** Answers questions from the Journal page only. `rank` is the local search index's ranking; `ready` waits for privacy settings. */
export function startAsk(db: TrailmapDb, ready: Promise<unknown>, getSettings: () => RecordingSettings, rankIds: (question: string, limit: number, budgetMs: number) => Promise<string[]>) {
  const journal = chrome.runtime.getURL(JOURNAL_PATH);
  chrome.runtime.onMessage.addListener((message, sender, respond: (reply: AskReply) => void) => {
    if (message?.type !== ASK_MESSAGE || sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
        sender.url?.split(/[?#]/, 1)[0] !== journal || typeof message.question !== 'string') return;
    void (async () => {
      await ready;
      respond(await ask({ db, getSettings, rank: (question) => rankIds(question, CANDIDATES, SEMANTIC_BUDGET_MS) }, message.question));
    })().catch((error: unknown) => respond({ status: 'error', code: error instanceof CompanionRequestError ? error.code : 'internal',
      message: 'Trailmap could not answer that.' }));
    return true;
  });
}
