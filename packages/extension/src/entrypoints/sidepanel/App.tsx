import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useCallback } from 'react';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { RecordingControls } from '../../privacy/RecordingControls';
import { readPickingUp } from '../../threads/picking-up';
import { useLiveTrail } from '../../trail/useLiveTrail';
import { ModelJobAttention } from '../../ui/ModelJobAttention';
import { TrailmapNavigation } from '../../ui/TrailmapNavigation';
import { AiNotesStatus } from './AiNotesStatus';
import { LiveTrail } from './LiveTrail';
import { CompanionStatus } from './CompanionStatus';
import { FieldNotes } from './FieldNotes';
import { PageNotes } from './PageNotes';
import { PickingUpCard } from './PickingUpCard';
import { useCurrentVisitId } from './corrections-client';

/** Live open expeditions and the remaining Visits from today. */
export function App() {
  const trail = useLiveTrail();
  const currentVisitId = useCurrentVisitId(trail);
  const expeditionId = trail?.open.find(({ visits }) => visits.some((visit) =>
    visit.id === currentVisitId && !visit.privacyBlocked,
  ))?.expedition.id;
  const pickingUp = useJournalData(useCallback((db: TrailmapDb) =>
    expeditionId ? readPickingUp(db, expeditionId) : Promise.resolve(undefined), [expeditionId],
  ))?.data;
  return (
    <VStack className="min-h-dvh bg-body">
      <header><TrailmapNavigation compact /></header>
      <VStack as="main" gap={3} padding={4}>
        <ModelJobAttention />
        <RecordingControls />
        <AiNotesStatus />
        <CompanionStatus />
        {pickingUp && <PickingUpCard {...pickingUp} />}
        {trail && <FieldNotes expeditions={trail.finished} />}
        {trail && <PageNotes pages={trail.pageNotes} />}
        {trail && trail.open.length === 0 && trail.today.length === 0 && (
          <Text type="supporting">Your trail will appear here as you browse.</Text>
        )}
        {trail && <LiveTrail trail={trail} currentVisitId={currentVisitId} priorReads={pickingUp?.priorReads} />}
      </VStack>
    </VStack>
  );
}
