import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { threadHref } from '../../journal/links';
import type { readPickingUp } from '../../threads/picking-up';
import { FieldNotesMarkdown } from '../../wrapup/FieldNotesMarkdown';

export function PickingUpCard({ thread, days, summary, looseEnds }: NonNullable<Awaited<ReturnType<typeof readPickingUp>>>) {
  return (
    <Card padding={3} variant="muted">
      <VStack gap={2}>
        <Heading level={2}>Picking up: {thread.title} (last session {days} {days === 1 ? 'day' : 'days'} ago)</Heading>
        <VStack gap={1}>
          <Heading level={3}>Last time</Heading>
          {summary ? <FieldNotesMarkdown>{summary}</FieldNotesMarkdown> : <Text type="supporting">No summary saved.</Text>}
        </VStack>
        {looseEnds && (
          <VStack gap={1}>
            <Heading level={3}>Loose ends</Heading>
            <FieldNotesMarkdown>{looseEnds}</FieldNotesMarkdown>
          </VStack>
        )}
        <Link href={threadHref(thread.id)} target="_blank" rel="noopener noreferrer">View thread</Link>
      </VStack>
    </Card>
  );
}
