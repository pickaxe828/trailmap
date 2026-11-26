import type { Query, Visit } from '@trailmap/shared';
import { canonicalizeUrl } from '../capture/canonical';
import { toVisitTransition } from '../capture/recorder';
import { googleSearchSurface, parseSearchQuery } from '../capture/search';

export type HistoryApi = {
  search(query: chrome.history.HistoryQuery): Promise<Pick<chrome.history.HistoryItem, 'url' | 'title'>[]>;
  getVisits(details: { url: string }): Promise<Pick<chrome.history.VisitItem, 'visitId' | 'visitTime' | 'transition' | 'referringVisitId'>[]>;
};

export type HistoryStop = { visit: Visit; query?: Query };

type Options = {
  start: number;
  end: number;
  shouldRecord: (url: string) => boolean;
  signal: AbortSignal;
};

/** Read browser metadata only. Chrome doesn't record tab IDs, qualifiers, DOM or engagement here. */
export async function collectHistory(history: HistoryApi, { start, end, shouldRecord, signal }: Options): Promise<HistoryStop[]> {
  const pages = new Map<string, string>();
  async function search(startTime: number, endTime: number) {
    signal.throwIfAborted();
    const midpoint = Math.floor((startTime + endTime) / 2);
    const canSplit = midpoint > startTime && midpoint < endTime;
    const maxResults = canSplit ? 1_000 : 100_000;
    const results = await history.search({ text: '', startTime, endTime, maxResults });
    signal.throwIfAborted();
    if (results.length >= maxResults) {
      // The API has no cursor. Search narrower time ranges rather than silently dropping results.
      if (!canSplit) throw new Error('History interval too dense');
      await search(midpoint, endTime);
      await search(startTime, midpoint);
      return;
    }
    for (const { url, title } of results) {
      if (url && !pages.has(url) && shouldRecord(url) && shouldRecord(canonicalizeUrl(url))) pages.set(url, title ?? '');
    }
  }
  await search(start, end);

  const stops = new Map<string, HistoryStop & { referrer: string }>();
  for (const [url, title] of pages) {
    signal.throwIfAborted();
    if (!shouldRecord(url) || googleSearchSurface(url) === 'ai-mode') continue;
    const canonicalUrl = canonicalizeUrl(url);
    const visits = await history.getVisits({ url });
    signal.throwIfAborted();
    const search = parseSearchQuery(url);
    for (const { visitId, referringVisitId, visitTime, transition } of visits) {
      if (!visitId || visitTime === undefined || visitTime < start || visitTime > end ||
          transition === 'auto_subframe' || transition === 'manual_subframe') continue;
      const id = `history:${visitId}`;
      const visit: Visit = {
        id, url, canonicalUrl, title, tabId: -1, parentVisitId: null,
        transition: search ? 'search' : toVisitTransition({ transitionType: transition, transitionQualifiers: [] }),
        startedAt: visitTime, activeMs: 0, scrollDepth: 0, engagement: 'bounced', expeditionId: null, imported: true,
      };
      const query = search ? { ...search, id: `query:${id}`, visitId: id, at: visitTime, expeditionId: null } : undefined;
      stops.set(id, { visit, query, referrer: `history:${referringVisitId}` });
    }
  }

  // Chrome IDs are decimal strings; length first keeps IDs ordered numerically without rounding.
  const ordered = [...stops.values()].sort((a, b) => a.visit.startedAt - b.visit.startedAt ||
    a.visit.id.length - b.visit.id.length || a.visit.id.localeCompare(b.visit.id));
  const earlier = new Map<string, Visit>();
  return ordered.map(({ visit, query, referrer }) => {
    const parent = earlier.get(referrer);
    if (visit.transition === 'link' || visit.transition === 'form' || visit.transition === 'reload') {
      visit.parentVisitId = parent?.id ?? null;
    }
    earlier.set(visit.id, visit);
    return { visit, query };
  });
}
