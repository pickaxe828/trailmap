import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Thread } from '@trailmap/shared';
import { formatExpeditionDate } from '../../journal/links';

export function ThreadCardContent({ thread, count }: { thread: Thread; count: number }) {
  return (
    <VStack gap={2}>
      <HStack gap={2} justify="between" wrap="wrap">
        <Text type="label">Thread</Text>
        <Text type="supporting">{count} sessions{thread.status === 'done' && ' · Done'}</Text>
      </HStack>
      <Heading level={3} maxLines={2}>{thread.title}</Heading>
      {thread.question && thread.question !== thread.title && <Text type="supporting" maxLines={2}>{thread.question}</Text>}
      <Text type="supporting">Last active {formatExpeditionDate(thread.lastActiveAt)}</Text>
    </VStack>
  );
}
