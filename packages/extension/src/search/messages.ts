import type { SearchResult } from './index';

export const SEARCH_MESSAGE = 'trailmap.search';
export type SearchReply = { results: SearchResult[] } | { error: true };

export async function searchJournal(query: string, hybrid: boolean): Promise<SearchResult[]> {
  const reply: SearchReply | undefined = await chrome.runtime.sendMessage({ type: SEARCH_MESSAGE, query, hybrid });
  if (!reply || 'error' in reply) throw new Error('Local search unavailable');
  return reply.results;
}
