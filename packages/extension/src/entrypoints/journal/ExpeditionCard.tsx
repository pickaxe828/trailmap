import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition } from '@trailmap/shared';
import { expeditionHref, formatExpeditionDate } from '../../journal/links';

export function ExpeditionCard({ expedition }: { expedition: Expedition }) {
  const { id, title, startedAt, endedAt, drivingQuestion, unseenNotes, imported, kind } = expedition;
  return (
    <ClickableCard label={title} href={expeditionHref(id)} padding={4} height="100%" variant="transparent">
      <VStack gap={2}>
        <HStack gap={2} justify="between" wrap="wrap">
          <Text type="supporting">{formatExpeditionDate(startedAt)}</Text>
          {unseenNotes ? <Text type="label">New field notes</Text>
            : endedAt === null ? <Text type="label">In progress</Text>
            : imported && <Text type="label">Imported from history</Text>}
        </HStack>
        <Heading level={3} maxLines={2}>{title}</Heading>
        {drivingQuestion && drivingQuestion !== title && <Text type="supporting" maxLines={2}>{drivingQuestion}</Text>}
        {endedAt !== null && kind !== 'unclassified' && <Text type="label">{kind === 'learning' ? 'Learning' : 'Not learning'}</Text>}
      </VStack>
    </ClickableCard>
  );
}
