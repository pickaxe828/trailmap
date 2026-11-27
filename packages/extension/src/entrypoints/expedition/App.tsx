import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Visit } from '@trailmap/shared';
import { useCallback, useMemo, useState, type DragEvent } from 'react';
import type { TrailmapDb } from '../../db/db';
import { readExpedition, useJournalData } from '../../journal/data';
import { formatExpeditionDate } from '../../journal/links';
import { useJournalCorrection } from '../../journal/useJournalCorrection';
import { TrailGraphView } from '../../trail/TrailGraphView';
import { TrailmapShell } from '../../ui/TrailmapShell';
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
  const classification = useJournalCorrection();
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
    <TrailmapShell journalDetail title={expedition?.title ?? 'Expedition'}
      description={expedition?.drivingQuestion && expedition.drivingQuestion !== expedition.title
        ? expedition.drivingQuestion : 'Review the trail and field notes from this expedition.'}
      actions={expedition && (
        <HStack gap={2} wrap="wrap">
          <Button label={expedition.kind === 'learning' ? 'Mark as not learning' : 'Mark as learning'} size="sm"
            isDisabled={classification.busy} onClick={() => void classification.run({ action: 'classify', expeditionIds: [expedition.id],
              kind: expedition.kind === 'learning' ? 'errand' : 'learning' })} />
          <Button label="Rename expedition" size="sm" onClick={() => setAction({ kind: 'rename' })} />
          {canMove && <Button label="Merge expeditions" size="sm" onClick={() => setAction({ kind: 'merge' })} />}
        </HStack>
      )}>
      {expedition && <Text type="supporting">{formatExpeditionDate(expedition.startedAt)} · {
        expedition.kind === 'unclassified' ? 'Unclassified' : expedition.kind === 'learning' ? 'Learning' : 'Not learning'
      }</Text>}
      {classification.feedback}
      {!result && <Text>Loading expedition…</Text>}
      {result?.error && <Text role="alert">Could not load this expedition. Try reloading the page.</Text>}
      {result && !result.error && !expedition && <Text>This expedition no longer exists.</Text>}
      {review && (
        <VStack gap={4} className="lg:grid! lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <VStack as="section" aria-label="Expedition trail" gap={2} className="min-w-0">
            <Heading level={2}>Trail</Heading>
            <Text type="supporting">Select a stop to review it. Dashed lines lead to skipped pages.</Text>
            {review.graph.nodes.length > 0 ? (
              <VStack height="clamp(19rem, 57dvh, 45rem)" className="overflow-hidden rounded-lg border border-border bg-card">
                <TrailGraphView graph={review.graph} review={graphActions} />
              </VStack>
            ) : <Text type="supporting">This expedition has no recorded stops.</Text>}
          </VStack>
          <VStack as="aside" aria-label="Expedition notes and details" gap={4} className="min-w-0 lg:border-s lg:border-border lg:ps-4">
            {canMove && !!review.visits.length && (
              <VStack padding={2} className="rounded-lg border border-dashed border-border bg-card"
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
            <Card padding={4}><FieldNotesPane key={review.expedition.id} expedition={review.expedition} /></Card>
          </VStack>
          {action && <CorrectionDialog review={review} action={action} onClose={() => setAction(undefined)} />}
        </VStack>
      )}
    </TrailmapShell>
  );
}
