import type { VisitRecorder } from '../capture/recorder';
import type { TrailmapDb } from '../db/db';
import { createJournalCorrections } from '../journal/corrections';
import { journalMessage } from '../journal/messages';
import type { RecordingSettings } from '../privacy/policy';
import { createCorrections } from './corrections';
import { isCorrectionRequest } from './messages';
import { createCorrectionService } from './service';

/** Correct the trail only from the side panel or the Expedition page (PLAN §5). */
export function startCorrections(
  db: TrailmapDb,
  recorder: VisitRecorder,
  privacy: { getSettings(): RecordingSettings; setSiteSkipped(host: string, skip: boolean): Promise<void> },
) {
  const options = { db, now: Date.now, newId: () => crypto.randomUUID() };
  const service = createCorrectionService({ db, corrections: createCorrections(options), recorder, privacy,
    isIncognitoTab: async (tabId) => (await chrome.tabs.get(tabId)).incognito });
  const organise = createJournalCorrections(options);
  chrome.runtime.onMessage.addListener((input: unknown, sender, reply) => {
    if (!sender.url) return;
    const journal = journalMessage.safeParse(input);
    if (journal.success) {
      const source = URL.parse(sender.url);
      if (!source) return;
      source.search = '';
      source.hash = '';
      if (source.href !== chrome.runtime.getURL('/journal.html') &&
        !(source.href === chrome.runtime.getURL('/expedition.html') && ['classify', 'undo'].includes(journal.data.input.action))) return;
      organise(journal.data.input).then(reply, () => reply(null));
      return true;
    }
    if (!isCorrectionRequest(input)) return;
    if (sender.url !== chrome.runtime.getURL('/sidepanel.html')) {
      const source = URL.parse(sender.url);
      if (!source) return;
      source.search = '';
      source.hash = '';
      if (source.href !== chrome.runtime.getURL('/expedition.html') ||
        !['rename', 'merge', 'move', 'my-notes'].includes(input.action)) return;
    }
    service.handle(input).then(reply, () => reply(false));
    return true;
  });
}
