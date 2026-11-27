import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { VStack } from '@astryxdesign/core/VStack';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import type { Expedition } from '@trailmap/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useJournalData } from '../../journal/data';
import { planOrganisation, type OrganisationPlan } from '../../journal/organise';
import { useJournalCorrection } from '../../journal/useJournalCorrection';
import { readJournalResearch } from '../../threads/read';
import { TrailmapShell } from '../../ui/TrailmapShell';
import { ExpeditionCard } from './ExpeditionCard';
import { JournalSearch } from './JournalSearch';
import { OrganiseCard, type DropChoice } from './OrganiseCard';
import { SuggestionRows } from './SuggestionRows';
import { ThreadCard } from './ThreadCards';

function Cards({ children }: { children: ReactNode }) {
  const wide = useMediaQuery('(min-width: 64rem)');
  const medium = useMediaQuery('(min-width: 40rem)');
  return <Grid columns={wide ? 3 : medium ? 2 : 1} gap={4}>{children}</Grid>;
}

export function App() {
  const result = useJournalData(readJournalResearch);
  const { items = [], other = [], targets = [], merges, noted } = result?.data ?? {};
  const { run, busy, feedback } = useJournalCorrection();
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const selectButton = useRef<HTMLButtonElement>(null);
  const searchRegion = useRef<HTMLElement>(null);
  const focusSearch = useCallback(() => searchRegion.current?.querySelector('input')?.focus(), []);
  const standalone = [...items.flatMap((item) => item.kind === 'expedition' ? [item.expedition] : []), ...other];
  const threadCards = items.filter((item) => item.kind === 'thread');
  const selectedThreads = threadCards.filter(({ thread }) => selection.includes(thread.id));
  const selectedExpeditions = standalone.filter(({ id }) => selection.includes(id));
  const selected = [...selectedExpeditions, ...selectedThreads.flatMap(({ members }) => members)];
  const count = selectedExpeditions.length + selectedThreads.length;

  function cancel() {
    setSelecting(false);
    setSelection([]);
    selectButton.current?.focus();
  }
  useEffect(() => {
    if (!selecting || busy) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented &&
        !(event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]'))) cancel();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [selecting, busy]);

  function toggle(id: string) {
    setSelecting(true);
    setSelection((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }
  async function apply(plan: OrganisationPlan) {
    const saved = await run(plan);
    if (saved) cancel();
    return saved;
  }
  function button(label: string, plan: OrganisationPlan | null) {
    return <Button label={label} variant="secondary" isDisabled={busy || !plan} onClick={() => plan && void apply(plan)} />;
  }
  function dropChoices(sourceId: string, destination: Expedition[], threadId?: string): DropChoice[] {
    const source = standalone.find(({ id }) => id === sourceId);
    if (!source) return [];
    const pair = [source, ...destination];
    const group = threadId ? planOrganisation([source], { action: 'add', threadId }) : planOrganisation(pair, { action: 'start' });
    const merge = planOrganisation(pair, { action: 'merge' });
    return [
      ...(group ? [{ label: threadId ? 'Add to thread' : 'Start thread', plan: group }] : []),
      ...(merge ? [{ label: 'Merge into one expedition', plan: merge }] : []),
    ];
  }
  const addChoices = targets.flatMap(({ id, title }) => {
    const plan = planOrganisation(selectedExpeditions, { action: 'add', threadId: id });
    return plan ? [{ label: title, onClick: () => void apply(plan) }] : [];
  });
  const cardInteraction = { selecting, busy, toggle, run: apply };
  function expeditionCard(expedition: Expedition, suggestion?: Parameters<typeof SuggestionRows>[0]['group']) {
    return <OrganiseCard key={expedition.id} id={expedition.id} title={expedition.title} {...cardInteraction}
      checked={selection.includes(expedition.id)} canDrag={expedition.endedAt !== null}
      dropChoices={(source) => dropChoices(source, [expedition])}
      suggestions={<SuggestionRows expedition={expedition} group={suggestion} merges={merges?.get(expedition.id)} busy={busy} run={run} />}>
      <ExpeditionCard expedition={expedition} noted={!!noted?.has(expedition.id)} />
    </OrganiseCard>;
  }

  return (
    <TrailmapShell title="Journal" section="journal" focusJournalSearch={focusSearch}
      description="Revisit the questions, trails, and notes from your browsing.">
      <JournalSearch regionRef={searchRegion}>
        {!result && <Text>Loading your Journal…</Text>}
        {result?.error && <Text role="alert">Could not load the Journal. Try reloading the page.</Text>}
        {result?.data && !items.length && !other.length && <Text>Your expeditions will appear here as you browse.</Text>}
        {(items.length > 0 || other.length > 0) && (
          <VStack as="section" gap={4} aria-labelledby="expeditions-heading">
            <HStack justify="between" align="center" gap={2} wrap="wrap">
              <Heading level={2} id="expeditions-heading">Expeditions</Heading>
              <Button ref={selectButton} label={selecting ? 'Cancel selection' : 'Select'} size="sm" aria-pressed={selecting}
                onClick={() => selecting ? cancel() : setSelecting(true)} isDisabled={busy} />
            </HStack>
            {feedback}
            {count > 0 && (
              <VStack as="section" aria-label="Expedition selection" gap={2}>
                <Text role="status" type="label">{count} selected</Text>
                <Toolbar label="Organise selected cards" size="sm" startContent={
                  <HStack gap={1} wrap="wrap">
                    {button('Start thread', planOrganisation(selected, { action: 'start' }))}
                    <DropdownMenu button={{ label: 'Add to thread…', variant: 'secondary', isDisabled: busy || !addChoices.length }} items={addChoices} />
                    {button('Merge into one expedition', planOrganisation(selected, { action: 'merge' }))}
                    {button('Mark as learning', planOrganisation(selected, { action: 'classify', kind: 'learning' }))}
                    {button('Mark as not learning', planOrganisation(selected, { action: 'classify', kind: 'errand' }))}
                    <Button label="Cancel" variant="secondary" isDisabled={busy} onClick={cancel} />
                  </HStack>
                } />
              </VStack>
            )}
            <Cards>{items.map((item) => item.kind === 'expedition' ? expeditionCard(item.expedition, item.suggestion) : (
              <OrganiseCard key={item.thread.id} id={item.thread.id} title={item.thread.title} {...cardInteraction}
                checked={selection.includes(item.thread.id)} canDrag={false}
                dropChoices={(source) => dropChoices(source, item.members, item.thread.id)}>
                <ThreadCard thread={item.thread} count={item.members.length} />
              </OrganiseCard>
            ))}</Cards>
            {other.length > 0 && (
              <Collapsible defaultIsOpen={false} trigger={<Heading level={2}>Other browsing ({other.length})</Heading>}>
                <Cards>{other.map((expedition) => expeditionCard(expedition))}</Cards>
              </Collapsible>
            )}
          </VStack>
        )}
      </JournalSearch>
    </TrailmapShell>
  );
}
