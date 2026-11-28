import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition } from '@trailmap/shared';
import { formatExpeditionDate } from '../../journal/links';

/** Without notes of the user's own, a card is shown at lower emphasis (secondary text, still AA) with a hint. */
export function ExpeditionCardContent({ expedition, noted }: { expedition: Expedition; noted: boolean }) {
  const { title, startedAt, endedAt, drivingQuestion, unseenNotes, imported, kind } = expedition;
  return (
    <VStack gap={2} data-my-notes={noted ? 'written' : 'none'}>
      <HStack gap={2} justify="between" wrap="wrap">
        <Text type="supporting">{formatExpeditionDate(startedAt)}</Text>
        {unseenNotes ? <Text type="label">New field notes</Text>
          : endedAt === null ? <Text type="label">In progress</Text>
          : imported && <Text type="label">Imported from history</Text>}
      </HStack>
      <Heading level={3} maxLines={2} className={noted ? undefined : 'text-secondary'}>{title}</Heading>
      {drivingQuestion && drivingQuestion !== title && <Text type="supporting" maxLines={2}>{drivingQuestion}</Text>}
      {noted ? <Text type="label" color="accent">My notes</Text> : <Text type="supporting">No notes yet</Text>}
      {endedAt !== null && kind !== 'unclassified' && <Text type="label" color={noted ? undefined : 'secondary'}>{kind === 'learning' ? 'Learning' : 'Not learning'}</Text>}
    </VStack>
  );
}
