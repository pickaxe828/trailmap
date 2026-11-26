import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Visit } from '@trailmap/shared';
import { useCallback, useMemo, useState, type DragEvent } from 'react';
import type { TrailmapDb } from '../../db/db';
import { readExpedition, useJournalData } from '../../journal/data';
import { formatExpeditionDate } from '../../journal/links';
import { TrailGraphView } from '../../trail/TrailGraphView';
import { CorrectionDialog, type ExpeditionCorrection } from './CorrectionDialog';
import { FieldNotesPane } from './FieldNotesPane';
import { StopDetails } from './StopDetails';

const VISIT_DRAG_TYPE = 'application/x-trailmap-visit';

function dragVisit(event: DragEvent, visit: Visit) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(VISIT_DRAG_TYPE, visit.id);
}

export function App() {
  const id = new URLSearchParams(window.location.search).get('id');
  const read = useCallback((db: TrailmapDb) => id ? readExpedition(db, id) : Promise.resolve(null), [id]);
  const result = useJournalData(read);
  const review = result?.data;
  const expedition = review?.expedition;
  const [selected, setSelected] = useState<string | undefined>(() => new URLSearchParams(location.search).get('stop') ?? undefined);
  const [action, setAction] = useState<ExpeditionCorrection>();
  const canMove = !!review?.alternatives.length;
  const graphActions = useMemo(() => review ? {
    summaries: review.summaries, onSelect: setSelected, onDragVisit: canMove ? dragVisit : undefined,
  } : undefined, [review, canMove]);
  const move = (visit: Visit) => setAction({ kind: 'move', visit });
  function dropVisit(event: DragEvent) {
    if (!event.dataTransfer.types.includes(VISIT_DRAG_TYPE)) return;
    event.preventDefault();
    const visitId = event.dataTransfer.getData(VISIT_DRAG_TYPE);
    const visit = review?.visits.find(({ id }) => id === visitId);
    if (visit) move(visit);
  }

  return (
    <Layout defaultHasDividers
      header={(
        <LayoutHeader padding={4}>
          <HStack align="end" justify="between" gap={3} wrap="wrap">
            <VStack gap={1}>
              <Link href={chrome.runtime.getURL('/journal.html')}>Journal</Link>
              <Heading level={1}>{expedition?.title ?? 'Expedition'}</Heading>
              {expedition?.drivingQuestion && expedition.drivingQuestion !== expedition.title && <Text>{expedition.drivingQuestion}</Text>}
              {expedition && <Text type="supporting">{formatExpeditionDate(expedition.startedAt)}</Text>}
            </VStack>
            {expedition && (
              <HStack gap={2} wrap="wrap">
                <Button label="Rename expedition" size="sm" onClick={() => setAction({ kind: 'rename' })} />
                {canMove && <Button label="Merge expeditions" size="sm" onClick={() => setAction({ kind: 'merge' })} />}
              </HStack>
            )}
          </HStack>
        </LayoutHeader>
      )}
      content={(
        <LayoutContent padding={4} role="main">
          {!result && <Text>Loading expedition…</Text>}
          {result?.error && <Text role="alert">Could not load this expedition. Try reloading the page.</Text>}
          {result && !result.error && !expedition && <Text>This expedition no longer exists.</Text>}
          {review && (
            <VStack gap={4} className="lg:grid! lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <VStack as="section" aria-label="Expedition trail" gap={2} className="min-w-0">
                <Heading level={2}>Trail</Heading>
                <Text type="supporting">Select a stop to review it. Dashed lines lead to skipped pages.</Text>
                {review.graph.nodes.length > 0 ? (
                  <VStack height="clamp(19rem, 57dvh, 45rem)" className="overflow-hidden rounded-lg border border-border">
                    <TrailGraphView graph={review.graph} review={graphActions} />
                  </VStack>
                ) : <Text type="supporting">This expedition has no recorded stops.</Text>}
              </VStack>
              <VStack as="aside" aria-label="Expedition notes and details" gap={4} className="min-w-0 lg:border-s lg:border-border lg:ps-4">
                {canMove && !!review.visits.length && (
                  <VStack padding={2} className="rounded-lg border border-dashed border-border bg-body"
                    onDragOver={(event: DragEvent) => {
                      if (!event.dataTransfer.types.includes(VISIT_DRAG_TYPE)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }} onDrop={dropVisit}>
                    <Text type="supporting">Drop a trail card here to move it.</Text>
                  </VStack>
                )}
                {selected && <StopDetails review={review} selected={selected} onSelect={setSelected}
                  onMove={canMove ? move : undefined} onClose={() => setSelected(undefined)} />}
                <FieldNotesPane key={review.expedition.id} expedition={review.expedition} />
              </VStack>
              {action && <CorrectionDialog review={review} action={action} onClose={() => setAction(undefined)} />}
            </VStack>
          )}
        </LayoutContent>
      )}
    />
  );
}
