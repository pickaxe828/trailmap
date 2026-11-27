import { expect, test } from 'bun:test';
import type { SearchResult } from './index';
import { createOmnibox, type Disposition, type Suggestion } from './omnibox';

const result: SearchResult = { id: 'page:guide', kind: 'page', title: 'A <guide> & notes', href: 'https://learn.test/guide', detail: 'learn.test', snippet: '' };
const note: SearchResult = { id: 'living-note:t', kind: 'note', title: 'Replication', href: '/thread.html?id=t', detail: 'Living note', snippet: '' };

function harness(search: (query: string) => Promise<SearchResult[]>) {
  const opened: [string, Disposition][] = [];
  const omnibox = createOmnibox(search, (id) => [result, note].find((item) => item.id === id)?.href,
    async (href, disposition) => { opened.push([href, disposition]); });
  const suggestions: Suggestion[] = [];
  return { ...omnibox, opened, suggestions, changed: (text: string) => omnibox.changed(text, (items) => { suggestions.push(...items); }) };
}

test('omnibox suggestions escape markup and Enter opens the selected result in the requested tab', async () => {
  const omni = harness(async () => [result, note]);
  await omni.changed('guide');
  expect(omni.suggestions[0]?.description).toBe('<dim>Page</dim> A &lt;guide&gt; &amp; notes');
  await omni.entered(omni.suggestions[1]!.content, 'newBackgroundTab');
  expect(omni.opened).toEqual([['/thread.html?id=t', 'newBackgroundTab']]);
});

test('omnibox ignores superseded suggestions and unselected Enter opens the best current result', async () => {
  const slow = Promise.withResolvers<SearchResult[]>();
  const omni = harness(async (query) => query === 'old' ? slow.promise : [note]);
  const old = omni.changed('old');
  await omni.changed('new');
  slow.resolve([result]);
  await old;
  expect(omni.suggestions.map(({ description }) => description)).toEqual(['<dim>Living note</dim> Replication']);
  await omni.entered('new', 'currentTab');
  expect(omni.opened).toEqual([['/thread.html?id=t', 'currentTab']]);
});

test('unmatched omnibox text stays in local Journal search', async () => {
  const omni = harness(async () => []);
  await omni.entered('missing query', 'newForegroundTab');
  expect(omni.opened).toEqual([['/journal.html?q=missing+query', 'newForegroundTab']]);
});

test('tm ?question opens Ask in the Journal, searches nothing, and suggests nothing', async () => {
  let searches = 0;
  const omni = harness(async () => { searches++; return [result]; });
  await omni.changed('?how do tombstones work');
  expect(omni.suggestions).toEqual([]);
  await omni.entered('?  how do tombstones work ', 'currentTab');
  await omni.entered('?', 'newForegroundTab');
  expect(omni.opened).toEqual([['/journal.html?ask=how+do+tombstones+work', 'currentTab'], ['/journal.html', 'newForegroundTab']]);
  expect(searches).toBe(0);
});
