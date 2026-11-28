import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Slider } from '@astryxdesign/core/Slider';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { Typeahead, type SearchableItem, type SearchSource } from '@astryxdesign/core/Typeahead';
import { VStack } from '@astryxdesign/core/VStack';
import { useMemo, useState } from 'react';
import { AtlasMap } from '../../atlas/AtlasMap';
import { readAtlas } from '../../atlas/data';
import { buildAtlasGraph, isConceptInScope, isConceptShown, shouldLabelAll, topConceptIds } from '../../atlas/graph';
import { conceptNameKey } from '../../concepts/evidence';
import { useJournalData } from '../../journal/data';
import { TrailmapShell } from '../../ui/TrailmapShell';
import { ConceptCard } from './ConceptCard';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const numberFormat = new Intl.NumberFormat();

type AtlasData = Awaited<ReturnType<typeof readAtlas>>;
type ConceptMatch = SearchableItem & { terms: string[]; firstSeen: number };

function AtlasView({ concepts: learned, seen, dismissed, edges, threads }: AtlasData) {
  const [includeSeen, setIncludeSeen] = useState(false);
  const concepts = useMemo(() => includeSeen ? [...learned, ...seen] : learned, [includeSeen, learned, seen]);
  const { graph, byId, dates, matches } = useMemo(() => {
    const graph = buildAtlasGraph(concepts, edges);
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    const matches: ConceptMatch[] = graph.nodes().map((id) => {
      const { name, aliases, firstSeen } = byId.get(id)!;
      return { id, label: name, terms: [name, ...aliases].map(conceptNameKey), firstSeen };
    });
    const dates = [...new Set(concepts.map(({ firstSeen }) => firstSeen))].sort((a, b) => a - b);
    return { graph, byId, dates, matches };
  }, [concepts, edges]);
  const [replayAt, setReplayAt] = useState<number>();
  const [selection, setSelection] = useState(() => new URLSearchParams(window.location.search).get('concept') ?? undefined);
  const [threadId, setThreadId] = useState('');
  const thread = threads.find(({ id }) => id === threadId);
  const scope = thread?.conceptIds;
  const top = useMemo(() => topConceptIds(graph, undefined, scope), [graph, scope]);
  const replayIndex = replayAt === undefined ? dates.length - 1 : Math.max(0, dates.findLastIndex((date) => date <= replayAt));
  const cutoff = dates[replayIndex] ?? 0;
  const hidden = selection ? dismissed.find(({ id }) => id === selection) : undefined;
  const concept = selection ? byId.get(selection) : undefined;
  const selected = concept && isConceptInScope(concept.id, concept.firstSeen, { cutoff, scope }) ? concept : undefined;
  const base = useMemo(() => ({ top, cutoff, scope, focused: selected?.id }), [top, cutoff, scope, selected?.id]);
  const shown = matches.filter(({ id, firstSeen }) => isConceptShown(id, firstSeen, base)).length;
  const filter = useMemo(() => ({ ...base, labelAll: shouldLabelAll(shown) }), [base, shown]);
  const neighbours = selected ? graph.neighbors(selected.id).map((id) => byId.get(id)!)
    .filter(({ id, firstSeen }) => isConceptInScope(id, firstSeen, filter)).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const searchSource = useMemo<SearchSource<ConceptMatch>>(() => ({
    search(query) {
      const key = conceptNameKey(query);
      if (!key) return [];
      const exact: ConceptMatch[] = [];
      const partial: ConceptMatch[] = [];
      for (const match of matches) {
        if (!isConceptInScope(match.id, match.firstSeen, { cutoff, scope })) continue;
        if (match.terms.includes(key)) exact.push(match);
        else if (match.terms.some((term) => term.includes(key))) partial.push(match);
      }
      return [...exact, ...partial].slice(0, 10);
    },
    bootstrap: () => matches.filter(({ id, firstSeen }) => isConceptInScope(id, firstSeen, { cutoff, scope })).slice(0, 5),
  }), [cutoff, matches, scope]);

  return (
    <VStack gap={4} className="min-h-0 grow">
      <HStack gap={6} wrap="wrap" align="end">
        <VStack className="min-w-0 grow basis-64">
          <Typeahead label="Find a concept" placeholder="Search names or aliases" searchSource={searchSource}
            value={matches.find(({ id }) => id === selected?.id) ?? null} onChange={(item) => setSelection(item?.id)}
            debounceMs={0} hasEntriesOnFocus emptySearchText="No matching concepts" />
        </VStack>
        {threads.length > 0 && (
          <VStack className="min-w-0 grow basis-64">
            <Selector label="Filter by thread" width="100%" hasSearch={threads.length > 8}
              options={[{ value: '', label: 'All threads' }, ...threads.map(({ id, title }) => ({ value: id, label: title }))]}
              value={thread?.id ?? ''} onChange={(id) => { setThreadId(id); setSelection(undefined); }} />
          </VStack>
        )}
        <VStack className="min-w-0 grow basis-64">
          <Switch label="Include concepts I only saw" value={includeSeen}
            description={seen.length ? `${numberFormat.format(seen.length)} only glimpsed, shown faded` : 'Nothing is only glimpsed yet'}
            onChange={setIncludeSeen} />
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
        <Card padding={0}>
          <VStack className="min-h-full" gap={1}>
            <HStack paddingInline={4} paddingBlockStart={3} gap={2} wrap="wrap" justify="between" align="center">
              <Text type="supporting">{numberFormat.format(shown)} of {numberFormat.format(graph.order)} concepts on the map</Text>
              <Text type="supporting">Size: pages studied · Colour: community · Solid: learned or studied · Faded: only seen on pages</Text>
            </HStack>
            {graph.order ? <AtlasMap graph={graph} filter={filter} onFocus={setSelection} /> : (
              <VStack padding={5}><Text role="status">Nothing on the map yet. Turn on “Include concepts I only saw” to see what you glimpsed.</Text></VStack>
            )}
          </VStack>
        </Card>
        <VStack className="min-h-0 min-w-0 lg:overflow-y-auto">
          {selected || hidden ? <ConceptCard key={(selected ?? hidden)!.id} concept={(selected ?? hidden)!} hidden={!!hidden}
              neighbours={neighbours} onFocus={setSelection} onClose={() => setSelection(undefined)} /> : (
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
    <TrailmapShell title="Atlas" section="atlas" description="Explore the concepts you’ve learned across expeditions.">
      {!result && <Text role="status">Loading your Atlas…</Text>}
      {result?.error && <Text role="alert">Could not load the Atlas. Try reloading the page.</Text>}
      {result?.data && (result.data.concepts.length || result.data.seen.length || result.data.dismissed.length ? <AtlasView {...result.data} /> : (
        <Card padding={5}><Text>Your Atlas will grow as you read pages that explain concepts and write about them in your notes. Opening a page is not learning, so passing mentions stay off the map.</Text></Card>
      ))}
    </TrailmapShell>
  );
}
