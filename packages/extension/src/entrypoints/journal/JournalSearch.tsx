import { Heading } from '@astryxdesign/core/Heading';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { MAX_SEARCH_QUERY, type SearchKind, type SearchResult } from '../../search/index';
import { searchJournal } from '../../search/messages';
import { JOURNAL_SEARCH_PARAM } from '../../ui/TrailmapShell';

const groups: [SearchKind, string][] = [['page', 'Pages'], ['concept', 'Concepts'], ['note', 'Notes']];
type SearchState = { query: string; results: SearchResult[]; pending: boolean; error?: true };

export function JournalSearch({ children, regionRef, ask }: { children: ReactNode; regionRef: Ref<HTMLElement>; ask?: ReactNode }) {
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
      <VStack as="section" aria-label="Search" gap={2} ref={regionRef}>
        <TextInput type="search" label="Search Journal" placeholder="Search pages, concepts, and notes"
          value={input} onChange={(value) => setInput(value.slice(0, MAX_SEARCH_QUERY))} hasClear
          hasAutoFocus={new URLSearchParams(location.search).has(JOURNAL_SEARCH_PARAM)}
          autoComplete="off" enterKeyHint="search" isLoading={pending} />
        <Text type="supporting">You can also type “tm” followed by a space in the address bar.</Text>
      </VStack>
      {ask}
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
                  <ListItem key={id} label={<Text type="label" color="accent" maxLines={2} className="underline">{title}</Text>}
                    description={<Text type="supporting" maxLines={2}>{detail}{snippet ? ` · ${snippet}` : ''}</Text>}
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
