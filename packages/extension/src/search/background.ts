import type { TrailmapDb } from '../db/db';
import { getEmbedder } from '../embeddings/background';
import { observeSearchCorpus } from './corpus';
import { MAX_SEARCH_QUERY, SearchIndex } from './index';
import { SEARCH_MESSAGE, type SearchReply } from './messages';
import { createOmnibox } from './omnibox';

const JOURNAL_PATH = '/journal.html';
const JOURNAL_LIMIT = 60;
const SUGGESTION_LIMIT = 5;

export function startSearch(db: TrailmapDb) {
  const index = new SearchIndex(getEmbedder());
  let ready: Promise<void> | undefined;
  function prepare() {
    ready ??= new Promise<void>((resolve, reject) => {
      observeSearchCorpus(db).subscribe({
        next: (documents) => { index.update(documents); resolve(); },
        error: (error) => { index.update([]); ready = undefined; reject(error); },
      });
    });
    return ready;
  }

  const origin = chrome.runtime.getURL('/');
  const journal = chrome.runtime.getURL(JOURNAL_PATH);
  chrome.runtime.onMessage.addListener((message, sender, respond: (reply: SearchReply) => void) => {
    if (message?.type !== SEARCH_MESSAGE || sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
        sender.url?.split(/[?#]/, 1)[0] !== journal || typeof message.query !== 'string' ||
        message.query.length > MAX_SEARCH_QUERY || typeof message.hybrid !== 'boolean') return;
    const query = message.query.trim();
    void (async () => {
      await prepare();
      const results = message.hybrid ? await index.search(query, JOURNAL_LIMIT, 10_000) : index.keyword(query, JOURNAL_LIMIT);
      respond({ results });
    })().catch(() => respond({ error: true }));
    return true;
  });

  const omnibox = createOmnibox(async (query) => {
    await prepare();
    return index.search(query.slice(0, MAX_SEARCH_QUERY), SUGGESTION_LIMIT, 650);
  }, (id) => index.href(id), async (href, disposition) => {
    const url = new URL(href, origin).href;
    if (disposition === 'currentTab') await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
  });
  chrome.omnibox.setDefaultSuggestion({ description: 'Search Trailmap: <match>%s</match>' });
  chrome.omnibox.onInputChanged.addListener((text, suggest) => { void omnibox.changed(text, suggest).catch(() => {}); });
  chrome.omnibox.onInputCancelled.addListener(omnibox.cancel);
  chrome.omnibox.onInputEntered.addListener((text, disposition) => { void omnibox.entered(text, disposition).catch(() => {}); });
}
