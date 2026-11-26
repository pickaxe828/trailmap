import type { SVGProps } from 'react';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
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

// Heroicons cog (MIT); Astryx's semantic settings icon is a wrench.
function SettingsGear(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.128.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.246c.275.476.166 1.08-.259 1.43l-1.004.827c-.293.241-.438.613-.43.992a6.8 6.8 0 0 1 0 .256c-.008.379.137.75.43.992l1.004.827c.425.35.534.954.259 1.43l-1.296 2.246a1.125 1.125 0 0 1-1.37.49l-1.217-.456c-.356-.133-.75-.072-1.075.124a6.57 6.57 0 0 1-.22.128c-.332.184-.582.496-.645.87l-.213 1.28c-.09.543-.56.941-1.11.941h-2.593c-.55 0-1.019-.398-1.109-.94l-.214-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.128c-.325-.196-.72-.257-1.075-.124l-1.217.456a1.125 1.125 0 0 1-1.37-.49l-1.296-2.246a1.125 1.125 0 0 1 .259-1.43l1.004-.827c.293-.241.438-.613.43-.992a6.77 6.77 0 0 1 0-.256c.008-.379-.137-.75-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.259-1.43L4.854 6.38a1.125 1.125 0 0 1 1.37-.491l1.217.456c.356.133.75.072 1.075-.124.073-.045.146-.087.22-.128.332-.184.582-.496.644-.87l.214-1.28Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

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
      <HStack as="header" align="center" justify="between" wrap="wrap" gap={2}>
        <Heading level={1}>Trailmap</Heading>
        <HStack as="nav" aria-label="Trailmap" gap={2} align="center" wrap="wrap" className="grow justify-end">
          <Link hasUnderline href={chrome.runtime.getURL('/journal.html')} target="_blank">Open Journal</Link>
          <Link hasUnderline href={chrome.runtime.getURL('/trail.html')} target="_blank">Open Trail</Link>
          <Link hasUnderline href={chrome.runtime.getURL('/atlas.html')} target="_blank">Open Atlas</Link>
          <IconButton label="Settings" tooltip="Settings" size="sm" icon={<Icon icon={SettingsGear} />}
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/settings.html') })} />
        </HStack>
      </HStack>
      <RecordingControls />
      <AiNotesStatus />
      <ModelJobAttention />
      <CompanionStatus />
      {pickingUp && <PickingUpCard {...pickingUp} />}
      {trail && <FieldNotes expeditions={trail.finished} />}
      {trail && <PageNotes pages={trail.pageNotes} />}
      {trail && trail.open.length === 0 && trail.today.length === 0 && (
        <Text type="supporting">Your trail will appear here as you browse.</Text>
      )}
      {trail && <LiveTrail trail={trail} currentVisitId={currentVisitId} priorReads={pickingUp?.priorReads} />}
    </VStack>
  );
}
