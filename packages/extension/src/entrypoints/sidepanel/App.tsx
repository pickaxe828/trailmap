import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TreeList, type TreeListItemData } from '@astryxdesign/core/TreeList';
import { VStack } from '@astryxdesign/core/VStack';
import { formatActiveTime } from '../../trail/format';
import { buildTrail, type TrailNode } from '../../trail/tree';
import { useLiveTrail } from '../../trail/useLiveTrail';
import { CompanionStatus } from './CompanionStatus';

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
      <Heading level={1}>Trailmap</Heading>
      <HStack gap={2} align="center">
        <StatusDot variant="success" label="Recording" isPulsing />
        <Text>Recording is on</Text>
      </HStack>
      <CompanionStatus />
      {trail && trail.open.length === 0 && trail.today.length === 0 && (
        <Text type="supporting">Your trail will appear here as you browse.</Text>
      )}
      {trail && trail.open.length > 0 && (
        <VStack gap={2}>
          <Heading level={2}>Open expeditions</Heading>
          {trail.open.map(({ expedition, visits }) => (
            <TreeList key={expedition.id}
              header={<Heading level={3}>{expedition.title}</Heading>}
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
