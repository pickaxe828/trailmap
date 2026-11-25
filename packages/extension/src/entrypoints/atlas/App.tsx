import { AppShell } from '@astryxdesign/core/AppShell';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { Typeahead, type SearchableItem, type SearchSource } from '@astryxdesign/core/Typeahead';
import { VStack } from '@astryxdesign/core/VStack';
import { useMemo, useState } from 'react';
import { AtlasMap } from '../../atlas/AtlasMap';
import { readAtlas } from '../../atlas/data';
import { buildAtlasGraph, isConceptShown, topConceptIds } from '../../atlas/graph';
import { conceptNameKey } from '../../concepts/evidence';
import { useJournalData } from '../../journal/data';
import { ConceptCard } from './ConceptCard';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const numberFormat = new Intl.NumberFormat();

type AtlasData = Awaited<ReturnType<typeof readAtlas>>;
type ConceptMatch = SearchableItem & { terms: string[]; firstSeen: number };

function AtlasView({ concepts, edges }: AtlasData) {
  const { graph, byId, top, dates, matches } = useMemo(() => {
    const graph = buildAtlasGraph(concepts, edges);
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    const matches: ConceptMatch[] = graph.nodes().map((id) => {
      const { name, aliases, firstSeen } = byId.get(id)!;
      return { id, label: name, terms: [name, ...aliases].map(conceptNameKey), firstSeen };
    });
    const dates = [...new Set(concepts.map(({ firstSeen }) => firstSeen))].sort((a, b) => a - b);
    return { graph, byId, top: topConceptIds(graph), dates, matches };
  }, [concepts, edges]);
  const [replayAt, setReplayAt] = useState<number>();
  const [selection, setSelection] = useState<string>();
  const replayIndex = replayAt === undefined ? dates.length - 1 : Math.max(0, dates.findLastIndex((date) => date <= replayAt));
  const cutoff = dates[replayIndex]!;
  const concept = selection ? byId.get(selection) : undefined;
  const selected = concept && concept.firstSeen <= cutoff ? concept : undefined;
  const filter = useMemo(() => ({ top, cutoff, focused: selected?.id }), [top, cutoff, selected?.id]);
  const shown = matches.filter(({ id, firstSeen }) => isConceptShown(id, firstSeen, filter)).length;
  const neighbours = selected ? graph.neighbors(selected.id).map((id) => byId.get(id)!)
    .filter(({ firstSeen }) => firstSeen <= cutoff).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const searchSource = useMemo<SearchSource<ConceptMatch>>(() => ({
    search(query) {
      const key = conceptNameKey(query);
      if (!key) return [];
      const exact: ConceptMatch[] = [];
      const partial: ConceptMatch[] = [];
      for (const match of matches) {
        if (match.firstSeen > cutoff) continue;
        if (match.terms.includes(key)) exact.push(match);
        else if (match.terms.some((term) => term.includes(key))) partial.push(match);
      }
      return [...exact, ...partial].slice(0, 10);
    },
    bootstrap: () => matches.filter(({ firstSeen }) => firstSeen <= cutoff).slice(0, 5),
  }), [cutoff, matches]);

  return (
    <VStack gap={4} className="min-h-0 grow">
      <HStack gap={6} wrap="wrap" align="end">
        <VStack className="min-w-0 grow basis-64">
          <Typeahead label="Find a concept" placeholder="Search names or aliases" searchSource={searchSource}
            value={matches.find(({ id }) => id === selected?.id) ?? null} onChange={(item) => setSelection(item?.id)}
            debounceMs={0} hasEntriesOnFocus emptySearchText="No matching concepts" />
        </VStack>
        <VStack className="min-w-0 grow basis-64">
          <Slider label="Replay by date" min={0} max={Math.max(1, dates.length - 1)} value={replayIndex} valueDisplay="text"
            isDisabled={dates.length === 1} formatValue={(index) => dateFormat.format(dates[index] ?? dates[0])}
            onChange={(index: number) => {
              const nextDate = dates[index];
              if (nextDate === undefined) return;
              setReplayAt(index === dates.length - 1 ? undefined : nextDate);
              if (selected && selected.firstSeen > nextDate) setSelection(undefined);
            }} />
        </VStack>
      </HStack>
      <VStack className="grid min-h-0 grow grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card variant="muted" padding={0}>
          <VStack className="min-h-full" gap={1}>
            <HStack paddingInline={4} paddingBlockStart={3} gap={2} wrap="wrap" justify="between" align="center">
              <Text type="supporting">{numberFormat.format(shown)} of {numberFormat.format(graph.order)} concepts on the map</Text>
              <Text type="supporting">Size: exposure · Colour: community</Text>
            </HStack>
            <AtlasMap graph={graph} filter={filter} onFocus={setSelection} />
          </VStack>
        </Card>
        <VStack className="min-h-0 min-w-0 lg:overflow-y-auto">
          {selected ? <ConceptCard concept={selected} neighbours={neighbours} onFocus={setSelection} onClose={() => setSelection(undefined)} /> : (
            <Card padding={5}>
              <VStack gap={2}>
                <Heading level={2}>Where did I learn this?</Heading>
                <Text type="supporting">Choose a concept on the map or search by name to see its evidence.</Text>
              </VStack>
            </Card>
          )}
        </VStack>
      </VStack>
    </VStack>
  );
}

export function App() {
  const result = useJournalData(readAtlas);
  return (
    <AppShell variant="surface" contentPadding={6} mobileNav={false} topNav={(
      <TopNav label="Trailmap navigation" heading={<TopNavHeading heading="Trailmap" />} centerContent={(
        <>
          <TopNavItem label="Journal" href={chrome.runtime.getURL('/journal.html')} />
          <TopNavItem label="Atlas" href={chrome.runtime.getURL('/atlas.html')} isSelected />
        </>
      )} />
    )}>
      <VStack gap={4} className="mx-auto min-h-full w-full">
        <VStack gap={1}>
          <Heading level={1}>Atlas</Heading>
          <Text type="supporting">Explore the concepts you’ve learned across expeditions.</Text>
        </VStack>
        {!result && <Text role="status">Loading your Atlas…</Text>}
        {result?.error && <Text role="alert">Could not load the Atlas. Try reloading the page.</Text>}
        {result?.data && (result.data.concepts.length ? <AtlasView {...result.data} /> : (
          <Card padding={5}><Text>Your Atlas will grow as you read pages that explain concepts or encounter them across multiple pages.</Text></Card>
        ))}
      </VStack>
    </AppShell>
  );
}
