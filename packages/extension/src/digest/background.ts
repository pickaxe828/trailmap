import type { TrailmapDb } from '../db/db';
import type { RecordingSettings } from '../privacy/policy';
import { DIGEST_MESSAGE, type DigestReply } from './messages';
import { requestRecentDigest, startDigestSchedule, type DigestClock, type DigestLedger } from './schedule';
import { localTimeZone } from './week';

const LEDGER_KEY = 'trailmap.digest.lastWeek';
const JOURNAL_PATH = '/journal.html';

const ledger: DigestLedger = {
  read: async () => {
    const value = (await chrome.storage.local.get(LEDGER_KEY))[LEDGER_KEY];
    return typeof value === 'string' ? value : undefined;
  },
  write: (key) => chrome.storage.local.set({ [LEDGER_KEY]: key }),
};

/** Every Monday (local time) the previous week's digest is queued; the Journal can also ask for the last 7 days. */
export function startDigests(db: TrailmapDb, ready: Promise<unknown>, getSettings: () => RecordingSettings) {
  const clock: DigestClock = { now: Date.now, zone: localTimeZone };
  startDigestSchedule(db, ready, ledger, clock, chrome.alarms);
  const journal = chrome.runtime.getURL(JOURNAL_PATH);
  chrome.runtime.onMessage.addListener((message, sender, respond: (reply: DigestReply) => void) => {
    if (message?.type !== DIGEST_MESSAGE || sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.url?.split(/[?#]/, 1)[0] !== journal) return;
    void ready.then(() => requestRecentDigest(db, getSettings, clock)).then(respond).catch(() => respond({ status: 'nothing' }));
    return true;
  });
}
