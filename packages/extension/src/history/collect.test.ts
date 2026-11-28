import { expect, test } from 'bun:test';
import { collectHistory, type HistoryApi } from './collect';

const root = 'https://learn.test/start?utm_source=test';
const child = 'https://learn.test/next';
const search = 'https://www.google.com/search?q=tombstones';
const start = 10_000;
const end = 20_000;
const collect = (history: HistoryApi) => collectHistory(history, { start, end, shouldRecord: () => true, signal: new AbortController().signal });

function fakeHistory(): HistoryApi {
  return {
    search: async () => [{ url: search, title: 'Search' }, { url: child, title: 'Next' }, { url: root, title: 'Start' }],
    getVisits: async ({ url }) => {
      if (url === root) return [
        { visitId: '1', referringVisitId: '0', visitTime: 9_999, transition: 'typed' },
        { visitId: '9', referringVisitId: '0', visitTime: 10_000, transition: 'typed' },
      ];
      if (url === search) return [{ visitId: '11', referringVisitId: '10', visitTime: 11_000, transition: 'generated' }];
      return [
        { visitId: '12', referringVisitId: '11', visitTime: 12_000, transition: 'form_submit' },
        { visitId: '10', referringVisitId: '9', visitTime: 10_000, transition: 'link' },
      ];
    },
  };
}

test('rebuilds a chronological trail from stable Chrome visit IDs, including a new search root', async () => {
  const result = await collect(fakeHistory());
  expect(result.map(({ visit }) => [visit.id, visit.parentVisitId, visit.transition, visit.imported])).toEqual([
    ['history:9', null, 'typed', true],
    ['history:10', 'history:9', 'link', true],
    ['history:11', null, 'search', true],
    ['history:12', 'history:11', 'form', true],
  ]);
  expect(result[0]?.visit.canonicalUrl).toBe('https://learn.test/start');
  expect(result[2]?.query).toMatchObject({ q: 'tombstones', visitId: 'history:11' });
  expect(await collect(fakeHistory())).toEqual(result);
});

test('history without composer input evidence does not import AI Mode', async () => {
  const history: HistoryApi = {
    search: async () => [{ url: 'https://www.google.com/search?udm=50&q=passive' }],
    getVisits: async () => [{ visitId: '9', referringVisitId: '0', visitTime: 10_000, transition: 'link' }],
  };
  expect(await collect(history)).toEqual([]);
});

test('cancelling while Chrome returns the final URL does not yield a trail', async () => {
  const abort = new AbortController();
  const history: HistoryApi = {
    search: async () => [{ url: root }],
    getVisits: async () => {
      abort.abort();
      return [{ visitId: '9', referringVisitId: '0', visitTime: 10_000, transition: 'typed' }];
    },
  };
  await expect(collectHistory(history, { start, end, shouldRecord: () => true, signal: abort.signal })).rejects.toThrow();
});

test('history import never imports a chat assistant page, even where the privacy policy would allow the host', async () => {
  const history: HistoryApi = {
    search: async () => ['https://chatgpt.com/c/abc', 'https://claude.ai/chat/1', 'https://gemini.google.com/app/1', 'https://chatgpt.com/.trailmap-chat/x']
      .map((url) => ({ url })),
    getVisits: async () => [{ visitId: '9', referringVisitId: '0', visitTime: 10_000, transition: 'link' }],
  };
  expect(await collect(history)).toEqual([]);
});
