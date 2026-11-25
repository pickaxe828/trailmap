import type { VisitRecorder } from '../capture/recorder';
import type { TrailmapDb } from '../db/db';
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
  const service = createCorrectionService({ db, corrections: createCorrections(options), recorder, privacy });
  chrome.runtime.onMessage.addListener((input: unknown, sender, reply) => {
    if (!isCorrectionRequest(input) || !sender.url) return;
    if (sender.url !== chrome.runtime.getURL('/sidepanel.html')) {
      const source = URL.parse(sender.url);
      if (!source) return;
      source.search = '';
      source.hash = '';
      if (source.href !== chrome.runtime.getURL('/expedition.html') ||
        !['rename', 'merge', 'move', 'field-notes'].includes(input.action)) return;
    }
    service.handle(input).then(reply, () => reply(false));
    return true;
  });
}
