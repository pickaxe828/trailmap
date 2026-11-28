import { MAX_ASK_QUESTION } from '../ask/messages';
import type { SearchResult } from './index';

export type Disposition = 'currentTab' | 'newForegroundTab' | 'newBackgroundTab';
export type Suggestion = { content: string; description: string };
const TOKEN_PREFIX = ':trailmap-result:';
const label = { page: 'Page', concept: 'Concept', note: 'Note' };
const xml = (text: string) => text.replace(/[&<>]/g, (char) => char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;');

export function createOmnibox(
  search: (query: string) => Promise<SearchResult[]>,
  resolve: (id: string) => string | undefined,
  open: (href: string, disposition: Disposition) => Promise<void>,
) {
  let generation = 0;
  let shown: { query: string; ids: string[]; tokens: Map<string, string> } | undefined;
  const cancel = () => { generation++; shown = undefined; };
  const asking = (text: string) => text.trimStart().startsWith('?');
  const find = (query: string) => query ? search(query).catch(() => []) : Promise.resolve([]);
  return {
    cancel,
    async changed(text: string, suggest: (suggestions: Suggestion[]) => void) {
      const request = ++generation;
      if (asking(text)) { shown = undefined; return; } // A question is answered in the Journal, not suggested here.
      const query = text.trim();
      const results = await find(query);
      if (request !== generation) return;
      const tokens = new Map<string, string>();
      const suggestions = results.map(({ id, kind, title, detail }, i) => {
        const content = `${TOKEN_PREFIX}${request}:${i}`;
        tokens.set(content, id);
        const type = kind === 'note' ? detail : label[kind];
        return { content, description: `<dim>${xml(type)}</dim> ${xml(title.replace(/\s+/g, ' ').slice(0, 150))}` };
      });
      shown = { query, tokens, ids: results.map(({ id }) => id) };
      suggest(suggestions);
    },
    async entered(text: string, disposition: Disposition) {
      const current = shown;
      cancel();
      if (asking(text)) {
        const question = text.trimStart().slice(1).trim().slice(0, MAX_ASK_QUESTION);
        await open(question ? `/journal.html?${new URLSearchParams({ ask: question })}` : '/journal.html', disposition);
        return;
      }
      const token = text.startsWith(TOKEN_PREFIX);
      const query = token ? current?.query ?? '' : text.trim();
      const id = token ? current?.tokens.get(text) : current?.query === query
        ? current.ids[0] : (await find(query))[0]?.id;
      const href = id && resolve(id);
      await open(href || `/journal.html${query ? `?${new URLSearchParams({ q: query })}` : ''}`, disposition);
    },
  };
}
