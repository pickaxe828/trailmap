import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import type { ReactNode } from 'react';
import { useJournalData } from '../../journal/data';
import { expeditionHref } from '../../journal/links';
import { readJournalResearch } from '../../threads/read';
import { ExpeditionCard } from './ExpeditionCard';
import { JournalSearch } from './JournalSearch';
import { StandaloneCard, ThreadCard } from './ThreadCards';

function Cards({ children }: { children: ReactNode }) {
  const wide = useMediaQuery('(min-width: 64rem)');
  const medium = useMediaQuery('(min-width: 40rem)');
  return (
    <Grid columns={wide ? 3 : medium ? 2 : 1} gap={4}>
      {children}
    </Grid>
  );
}

export function App() {
  const result = useJournalData(readJournalResearch);
  const { items = [], errands = [], targets = [], mergeSuggestions = [] } = result?.data ?? {};

  return (
    <Layout contentWidth="72rem"
      header={(
        <LayoutHeader hasDivider padding={6}>
          <VStack gap={1}>
            <Heading level={1}>Journal</Heading>
            <Text type="supporting">Revisit the questions, trails, and notes from your browsing.</Text>
          </VStack>
        </LayoutHeader>
      )}
      content={(
        <LayoutContent padding={6} role="main">
          <VStack gap={6}>
            <JournalSearch>
              {!result && <Text>Loading your Journal…</Text>}
              {result?.error && <Text role="alert">Could not load the Journal. Try reloading the page.</Text>}
              {result?.data && !items.length && !errands.length && <Text>Your expeditions will appear here as you browse.</Text>}
              {items.length > 0 && (
                <VStack as="section" gap={4}>
                  <Heading level={2}>{items.some(({ kind }) => kind === 'thread') ? 'Research' : 'Expeditions'}</Heading>
                  <Cards>{items.map((item) => item.kind === 'thread'
                    ? <ThreadCard key={item.thread.id} thread={item.thread} count={item.count} />
                    : <StandaloneCard key={item.expedition.id} expedition={item.expedition} suggestion={item.suggestion} targets={targets} />)}</Cards>
                </VStack>
              )}
              {mergeSuggestions.length > 0 && (
                <VStack as="section" gap={2} aria-labelledby="merge-suggestions">
                  <Heading level={2} id="merge-suggestions">Merge suggestions</Heading>
                  <VStack as="ul" gap={2}>
                    {mergeSuggestions.map(({ source, target, reason }) => (
                      <VStack as="li" key={JSON.stringify([source.id, target.id])} gap={0.5}>
                        <Text as="p"><Link href={expeditionHref(source.id)}>{source.title}</Link>
                          {' and '}<Link href={expeditionHref(target.id)}>{target.title}</Link></Text>
                        {reason && <Text type="supporting">{reason}</Text>}
                      </VStack>
                    ))}
                  </VStack>
                </VStack>
              )}
              {errands.length > 0 && (
                <Collapsible defaultIsOpen={false} trigger={<Heading level={2}>Errands ({errands.length})</Heading>}>
                  <Cards>{errands.map((expedition) => <ExpeditionCard key={expedition.id} expedition={expedition} />)}</Cards>
                </Collapsible>
              )}
            </JournalSearch>
          </VStack>
        </LayoutContent>
      )}
    />
  );
}
