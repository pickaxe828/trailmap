import { ChromeEventSource, ChromeSessionStateStore, ensureTickAlarm, startAiCitationLinks } from '../capture/chrome-events';
import { VisitRecorder } from '../capture/recorder';
import { openTrailmapDb } from '../db/db';
import { startCorrections } from '../corrections/background';
import { forgetCascade } from '../corrections/forget';
import { startJobs } from '../jobs/background';
import { startPageSummary } from '../llm/background';
import { recoverModelAttempts } from '../llm/dispatch';
import { startSegmentation } from '../segmentation/background';
import { startCompanion } from '../companion/background';
import { createRecordingPrivacy } from '../privacy/background';
import { startThreadCorrections } from '../threads/background';
import { watchUnseenNotes } from '../wrapup/badge';
import { startVaultSync } from '../vault/background';
import { startHistoryImport } from '../history/background';
import { startSearch } from '../search/background';
import { startAsk } from '../ask/background';
import { startDigests } from '../digest/background';
import { startReview } from '../review/background';
import { configurePanelAction, isFirefox } from '../platform/browser';
import { readPdfOnPlatform } from '../platform/pdf';

export default defineBackground({
  // ESM keeps the lazy Firefox model runtime and its WASM out of the startup bundle.
  type: isFirefox ? 'module' : undefined,
  main: start,
});

function start() {
  startCompanion();

  configurePanelAction();

  // First install: open the onboarding tab.
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
      void chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    }
  });

  // Capture (docs/PLAN.md §4.1). Listeners must be registered synchronously here;
  // the recorder restores its state from `chrome.storage.session` before handling any of them.
  const db = openTrailmapDb();
  void recoverModelAttempts(db).catch(() => {});
  let unseenNotes = 0;
  const privacy = createRecordingPrivacy(() => unseenNotes, (host, settings) => forgetCascade(db, {
    kind: 'forget-site', host, denied: host === undefined, chatCapture: settings?.chatCapture, redditThreads: settings?.redditThreads, targetIds: host ? [`site:${host}`] : [],
    now: Date.now, newId: () => crypto.randomUUID(), quiet: true,
  }));
  const recorder = new VisitRecorder({
    db,
    source: new ChromeEventSource(),
    store: new ChromeSessionStateStore(),
    now: Date.now,
    shouldRecord: privacy.shouldRecord,
    shouldCaptureChat: privacy.shouldCaptureChat,
    policyReady: privacy.ready,
    screenDocuments: true,
    onPasswordStatusChanged: privacy.onPasswordStatusChanged,
    readPdf: readPdfOnPlatform,
    isIncognitoTab: async (tabId) => (await chrome.tabs.get(tabId)).incognito,
    // Gecko's PDF viewer runs no content scripts, so a .pdf URL has no document to wait for.
    admitPdfUrls: isFirefox,
    newId: () => crypto.randomUUID(),
  });
  recorder.start();
  startAiCitationLinks(recorder);
  const expeditions = startSegmentation(db, recorder, privacy.getSettings);
  startHistoryImport(expeditions, privacy);
  privacy.start(recorder);
  startCorrections(db, recorder, privacy);
  startThreadCorrections(db);
  startPageSummary(db, recorder, privacy.getSettings);
  startJobs(db, privacy.ready, privacy.getSettings);
  startVaultSync(db);
  const search = startSearch(db);
  startAsk(db, privacy.ready, privacy.getSettings, search.rank);
  startDigests(db, privacy.ready, privacy.getSettings);
  startReview(db, privacy.ready, privacy.getSettings);
  // The toolbar badge counts field notes nobody has viewed yet. No pop-ups.
  watchUnseenNotes(db, (count) => {
    unseenNotes = count;
    void privacy.refreshBadges().catch(() => {});
  });
  void ensureTickAlarm();
}
