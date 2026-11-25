import { ChromeEventSource, ensureTickAlarm } from '../capture/chrome-events';
import { VisitRecorder } from '../capture/recorder';
import { ChromeSessionStateStore } from '../capture/state-store';
import { openTrailmapDb } from '../db/db';
import { startSegmentation } from '../segmentation/background';
import { startCompanion } from '../companion/background';
import { createRecordingPrivacy } from '../privacy/background';

export default defineBackground(() => {
  startCompanion();

  // Clicking the toolbar icon opens the side panel.
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // First install: open the onboarding tab.
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
      void chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    }
  });

  // Capture (docs/PLAN.md §4.1). Listeners must be registered synchronously here;
  // the recorder restores its state from `chrome.storage.session` before handling any of them.
  const db = openTrailmapDb();
  const privacy = createRecordingPrivacy();
  const recorder = new VisitRecorder({
    db,
    source: new ChromeEventSource(),
    store: new ChromeSessionStateStore(),
    now: Date.now,
    shouldRecord: privacy.shouldRecord,
    policyReady: privacy.ready,
    screenDocuments: true,
    onPasswordStatusChanged: privacy.onPasswordStatusChanged,
    newId: () => crypto.randomUUID(),
  });
  startSegmentation(db, recorder);
  recorder.start();
  privacy.start(recorder);
  void ensureTickAlarm();
});
