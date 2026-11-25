import type { VisitRecorder } from '../capture/recorder';
import type { TrailmapDb } from '../db/db';
import type { RecordingSettings } from '../privacy/policy';
import { createCorrections } from './corrections';
import { isCorrectionRequest } from './messages';
import { createCorrectionService } from './service';

/** Side panel corrections (docs/PLAN.md §5 item 1). Only the side panel page may send them. */
export function startCorrections(
  db: TrailmapDb,
  recorder: VisitRecorder,
  privacy: { getSettings(): RecordingSettings; setSiteSkipped(host: string, skip: boolean): Promise<void> },
) {
  const options = { db, now: Date.now, newId: () => crypto.randomUUID() };
  const service = createCorrectionService({ db, corrections: createCorrections(options), recorder, privacy });
  chrome.runtime.onMessage.addListener((input: unknown, sender, reply) => {
    if (sender.url !== chrome.runtime.getURL('/sidepanel.html') || !isCorrectionRequest(input)) return;
    service.handle(input).then(reply, () => reply(false));
    return true;
  });
}
