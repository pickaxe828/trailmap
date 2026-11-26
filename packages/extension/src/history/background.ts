import type { RecordingSettings } from '../privacy/policy';
import { EXPEDITION_IDLE_SECONDS } from '../segmentation/config';
import type { ExpeditionRecorder } from '../segmentation/expedition-recorder';
import { collectHistory } from './collect';
import { HISTORY_IMPORT_PORT, isHistoryRange, type HistoryImportStatus, type HistoryRange } from './messages';

const DAY_MS = 24 * 60 * 60 * 1_000;

export function startHistoryImport(expeditions: ExpeditionRecorder, privacy: {
  ready: Promise<void>;
  getSettings: () => RecordingSettings;
  shouldRecord: (url: string) => boolean;
}) {
  const pages = new Set(['/onboarding.html', '/settings.html'].map((path) => chrome.runtime.getURL(path)));
  const ports = new Set<chrome.runtime.Port>();
  let status: HistoryImportStatus = { state: 'idle' };
  let run: AbortController | undefined;

  function send(port: chrome.runtime.Port) {
    try { port.postMessage(status); } catch { ports.delete(port); }
  }

  function publish(next: HistoryImportStatus) {
    status = next;
    for (const port of ports) send(port);
  }

  async function importHistory(days: HistoryRange, signal: AbortSignal) {
    let added = 0;
    try {
      await privacy.ready;
      signal.throwIfAborted();
      if (privacy.getSettings().paused) {
        publish({ state: 'paused' });
        return;
      }
      const end = Date.now();
      const stops = await collectHistory({
        search: (query) => chrome.history.search(query),
        getVisits: (details) => chrome.history.getVisits(details),
      }, { start: end - Number(days) * DAY_MS, end, shouldRecord: privacy.shouldRecord, signal });
      signal.throwIfAborted();
      const canImport = (visit: { url: string; canonicalUrl: string }) =>
        !signal.aborted && privacy.shouldRecord(visit.url) && privacy.shouldRecord(visit.canonicalUrl);
      publish({ state: 'writing', processed: 0, total: stops.length });
      let sessionStart = 0;
      let lastVisit = -Infinity;
      let lastProgress = Date.now();
      for (const [index, { visit, query }] of stops.entries()) {
        signal.throwIfAborted();
        if (privacy.getSettings().paused) {
          publish({ state: 'paused' });
          return;
        }
        if (!canImport(visit)) continue;
        if (visit.startedAt - lastVisit >= EXPEDITION_IDLE_SECONDS * 1_000) sessionStart = visit.startedAt;
        lastVisit = visit.startedAt;
        if (await expeditions.importVisit(visit, { sessionStart, query, canImport })) added++;
        if (!signal.aborted && Date.now() - lastProgress >= 100) {
          publish({ state: 'writing', processed: index + 1, total: stops.length });
          lastProgress = Date.now();
        }
      }
      signal.throwIfAborted();
      publish({ state: 'done', added });
    } catch {
      // Never send Chrome errors (which may contain a URL) to the UI or logs.
      publish(signal.aborted ? { state: 'cancelled', added } : { state: 'failed' });
    } finally {
      run = undefined;
    }
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== HISTORY_IMPORT_PORT) return;
    const url = port.sender?.url?.split(/[?#]/, 1)[0];
    if (port.sender?.id !== chrome.runtime.id || port.sender.frameId !== 0 || !url || !pages.has(url)) {
      port.disconnect();
      return;
    }
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener((input: { type?: unknown; days?: unknown } | null) => {
      if (input?.type === 'start' && isHistoryRange(input.days) && !run) {
        run = new AbortController();
        publish({ state: 'reading' });
        void importHistory(input.days, run.signal);
      } else if (input?.type === 'cancel' && run && !run.signal.aborted) {
        run.abort();
        publish({ state: 'cancelling' });
      }
    });
    send(port);
  });
}
