import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { TreeList, type TreeListItemData } from '@astryxdesign/core/TreeList';
import { VStack } from '@astryxdesign/core/VStack';
import { WRAP_UP_MESSAGE } from '../../wrapup/messages';
import { formatActiveTime } from '../../trail/format';
import { buildTrail, type TrailNode } from '../../trail/tree';
import { useLiveTrail } from '../../trail/useLiveTrail';
import { AiNotesStatus } from './AiNotesStatus';
import { CompanionStatus } from './CompanionStatus';
import { FieldNotes } from './FieldNotes';
import { PageNotes } from './PageNotes';
import { RecordingControls } from './RecordingControls';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function toItem({ visit, children }: TrailNode): TreeListItemData {
  return {
    id: visit.id,
    label: visit.title || visit.url,
    description: `${hostOf(visit.url)} · ${visit.transition} · ${formatActiveTime(visit.activeMs)}`,
    children: children.length > 0 ? children.map(toItem) : undefined,
    isExpanded: true,
  };
}

/** Live open expeditions and the remaining Visits from today. */
export function App() {
  const trail = useLiveTrail();
  return (
    <VStack gap={3} padding={4}>
      <HStack align="center" justify="between" wrap="wrap" gap={2}>
        <Heading level={1}>Trailmap</Heading>
        <Button size="sm" label="Open Trail" href={chrome.runtime.getURL('/trail.html')}
          target="_blank" rel="noopener noreferrer" />
      </HStack>
      <RecordingControls />
      <AiNotesStatus />
      <CompanionStatus />
      {trail && <FieldNotes expeditions={trail.finished} />}
      {trail && <PageNotes pages={trail.pageNotes} />}
      <Link href={chrome.runtime.getURL('/onboarding.html#sent-to-model')} target="_blank">Sent-to-model log</Link>
      {trail && trail.open.length === 0 && trail.today.length === 0 && (
        <Text type="supporting">Your trail will appear here as you browse.</Text>
      )}
      {trail && trail.open.length > 0 && (
        <VStack gap={2}>
          <Heading level={2}>Open expeditions</Heading>
          {trail.open.map(({ expedition, visits }) => (
            <TreeList key={expedition.id}
              header={(
                <HStack align="center" justify="between" gap={2}>
                  <Heading level={3}>{expedition.title}</Heading>
                  <Button size="sm" label="Wrap up" aria-label={`Wrap up expedition ${expedition.title}`}
                    clickAction={async () => { await chrome.runtime.sendMessage({ type: WRAP_UP_MESSAGE, expeditionId: expedition.id }).catch(() => {}); }} />
                </HStack>
              )}
              items={buildTrail(visits).map(toItem)}
            />
          ))}
        </VStack>
      )}
      {trail && trail.today.length > 0 && (
        <TreeList header={<Heading level={2}>Today</Heading>} items={buildTrail(trail.today).map(toItem)} />
      )}
    </VStack>
  );
}
