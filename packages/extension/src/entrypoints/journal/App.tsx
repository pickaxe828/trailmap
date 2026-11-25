import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import type { Expedition } from '@trailmap/shared';
import { readJournal, useJournalData } from '../../journal/data';
import { ExpeditionCard } from './ExpeditionCard';

function ExpeditionCards({ expeditions }: { expeditions: Expedition[] }) {
  const wide = useMediaQuery('(min-width: 64rem)');
  const medium = useMediaQuery('(min-width: 40rem)');
  return (
    <Grid columns={wide ? 3 : medium ? 2 : 1} gap={4}>
      {expeditions.map((expedition) => <ExpeditionCard key={expedition.id} expedition={expedition} />)}
    </Grid>
  );
}

export function App() {
  const result = useJournalData(readJournal);
  const expeditions = result?.data ?? [];
  const learning = expeditions.filter(({ kind }) => kind !== 'errand');
  const errands = expeditions.filter(({ kind }) => kind === 'errand');

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
            {!result && <Text>Loading your Journal…</Text>}
            {result?.error && <Text role="alert">Could not load the Journal. Try reloading the page.</Text>}
            {result?.data && !expeditions.length && <Text>Your expeditions will appear here as you browse.</Text>}
            {learning.length > 0 && (
              <VStack as="section" gap={4}>
                <Heading level={2}>Expeditions</Heading>
                <ExpeditionCards expeditions={learning} />
              </VStack>
            )}
            {errands.length > 0 && (
              <Collapsible defaultIsOpen={false} trigger={<Heading level={2}>Errands ({errands.length})</Heading>}>
                <ExpeditionCards expeditions={errands} />
              </Collapsible>
            )}
          </VStack>
        </LayoutContent>
      )}
    />
  );
}
