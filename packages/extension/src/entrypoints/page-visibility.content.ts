import { PAGE_VISIBILITY_MESSAGE, type PageVisibilityMessage } from '../capture/page-messages';

/**
 * Tells the background when the page becomes visible or hidden, one of the four
 * conditions for counting active time (docs/PLAN.md §4.1). Content that reads
 * the page itself (text, scroll, selections) is ticket 03's job.
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main() {
    const report = () => {
      const message: PageVisibilityMessage = {
        type: PAGE_VISIBILITY_MESSAGE,
        visible: document.visibilityState === 'visible',
      };
      // The background can be asleep or the extension reloading; neither matters here.
      chrome.runtime.sendMessage(message).catch(() => undefined);
    };
    report();
    document.addEventListener('visibilitychange', report);
  },
});
