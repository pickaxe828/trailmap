import { Heading } from '@astryxdesign/core/Heading';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState, type ReactNode } from 'react';
import { MAX_SEARCH_QUERY, type SearchKind, type SearchResult } from '../../search/index';
import { searchJournal } from '../../search/messages';

const groups: [SearchKind, string][] = [['page', 'Pages'], ['concept', 'Concepts'], ['note', 'Notes']];
type SearchState = { query: string; results: SearchResult[]; pending: boolean; error?: true };

export function JournalSearch({ children }: { children: ReactNode }) {
  const [input, setInput] = useState(() => (new URLSearchParams(window.location.search).get('q') ?? '').slice(0, MAX_SEARCH_QUERY));
  const [state, setState] = useState<SearchState>();
  const query = input.trim();
  const current = state?.query === query ? state : undefined;
  const pending = Boolean(query && (current?.pending ?? true));
  useEffect(() => {
    if (!query) return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        let results: SearchResult[] | undefined;
        try {
          results = await searchJournal(query, false);
          if (stale) return;
          setState({ query, results, pending: true });
          results = await searchJournal(query, true);
          if (!stale) setState({ query, results, pending: false });
        } catch {
          if (!stale) setState({ query, results: results ?? [], pending: false, ...(results ? {} : { error: true }) });
        }
      })();
    }, 150);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);

  return (
    <>
      <VStack as="section" aria-label="Search" gap={2}>
        <TextInput type="search" label="Search Journal" placeholder="Search pages, concepts, and notes"
          value={input} onChange={(value) => setInput(value.slice(0, MAX_SEARCH_QUERY))} hasClear
          autoComplete="off" enterKeyHint="search" isLoading={pending} />
        <Text type="supporting">You can also type “tm” followed by a space in the address bar.</Text>
      </VStack>
      {!query ? children : (
        <VStack gap={4}>
          {current?.error ? <Text role="alert">Could not search the Journal. Try again.</Text> : (
            <Text role="status" type="supporting">{pending ? 'Searching…' : current?.results.length ? 'Search results' : 'No matching pages, concepts, or notes.'}</Text>
          )}
          {groups.map(([kind, name]) => {
            const results = current?.results.filter((result) => result.kind === kind) ?? [];
            return results.length > 0 && (
              <List key={kind} header={<Heading level={2}>{name}</Heading>} hasDividers>
                {results.map(({ id, title, detail, href, snippet }) => (
                  <ListItem key={id} label={title} description={`${detail}${snippet ? ` · ${snippet}` : ''}`}
                    href={href} target={kind === 'page' ? '_blank' : undefined} />
                ))}
              </List>
            );
          })}
        </VStack>
      )}
    </>
  );
}
