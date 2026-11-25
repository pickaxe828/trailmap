import { ChromeEventSource, ensureTickAlarm } from '../capture/chrome-events';
import { VisitRecorder } from '../capture/recorder';
import { ChromeSessionStateStore } from '../capture/state-store';
import { openTrailmapDb } from '../db/db';
import { startCompanion } from '../companion/background';

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
  const recorder = new VisitRecorder({
    db: openTrailmapDb(),
    source: new ChromeEventSource(),
    store: new ChromeSessionStateStore(),
    now: Date.now,
    newId: () => crypto.randomUUID(),
  });
  recorder.start();
  void ensureTickAlarm();
});
