import { ChromeEventSource, ensureTickAlarm } from '../capture/chrome-events';
import { VisitRecorder } from '../capture/recorder';
import { ChromeSessionStateStore } from '../capture/state-store';
import { openTrailmapDb } from '../db/db';
import { startSegmentation } from '../segmentation/background';
import { startCompanion } from '../companion/background';

function shouldRecord(url: string): boolean {
  const { hostname, pathname } = new URL(url);
  if (hostname === 'auth.openai.com') return false;
  // OAuth callback URLs carry a one-time code. Keep them out of Visits and downstream page capture.
  return hostname !== '127.0.0.1' || !['/auth/callback', '/api/accounts/authorize'].includes(pathname);
}

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
  const recorder = new VisitRecorder({
    db,
    source: new ChromeEventSource(),
    store: new ChromeSessionStateStore(),
    now: Date.now,
    shouldRecord,
    newId: () => crypto.randomUUID(),
  });
  startSegmentation(db, recorder);
  recorder.start();
  void ensureTickAlarm();
});
