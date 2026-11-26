import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useCallback } from 'react';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { RecordingControls } from '../../privacy/RecordingControls';
import { readPickingUp } from '../../threads/picking-up';
import { useLiveTrail } from '../../trail/useLiveTrail';
import { ModelJobAttention } from '../../ui/ModelJobAttention';
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
    <VStack gap={3} padding={4}>
      <HStack align="center" justify="between" wrap="wrap" gap={2}>
        <Heading level={1}>Trailmap</Heading>
        <HStack gap={1} wrap="wrap">
          <Button size="sm" label="Open Journal" href={chrome.runtime.getURL('/journal.html')}
            target="_blank" rel="noopener noreferrer" />
          <Button size="sm" variant="secondary" label="Open Trail" href={chrome.runtime.getURL('/trail.html')}
            target="_blank" rel="noopener noreferrer" />
          <Button size="sm" variant="secondary" label="Open Atlas" href={chrome.runtime.getURL('/atlas.html')}
            target="_blank" rel="noopener noreferrer" />
        </HStack>
      </HStack>
      <RecordingControls />
      <AiNotesStatus />
      <ModelJobAttention />
      <CompanionStatus />
      {pickingUp && <PickingUpCard {...pickingUp} />}
      {trail && <FieldNotes expeditions={trail.finished} />}
      {trail && <PageNotes pages={trail.pageNotes} />}
      <HStack gap={2} wrap="wrap">
        <Link href={chrome.runtime.getURL('/settings.html')} target="_blank">Settings</Link>
        <Link href={chrome.runtime.getURL('/settings.html#sent-to-model')} target="_blank">Sent-to-model log</Link>
      </HStack>
      {trail && trail.open.length === 0 && trail.today.length === 0 && (
        <Text type="supporting">Your trail will appear here as you browse.</Text>
      )}
      {trail && <LiveTrail trail={trail} currentVisitId={currentVisitId} priorReads={pickingUp?.priorReads} />}
    </VStack>
  );
}
