import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { RecentChange } from '../../journal/recent';

/** The latest organise actions, read from the corrections log, each with its own Undo. */
export function RecentChanges({ changes, busy, undo }: { changes: RecentChange[]; busy: boolean; undo: (id: string) => void }) {
  if (!changes.length) return null;
  return (
    <Collapsible defaultIsOpen={false} trigger={<Heading level={2}>Recent changes ({changes.length})</Heading>}>
      <VStack as="ul" gap={2} aria-label="Recent changes" className="list-none p-0">
        {changes.map(({ id, at, label }) => (
          <HStack as="li" key={id} gap={3} align="center" justify="between" wrap="wrap">
            <VStack gap={0} className="min-w-0">
              <Text>{label}</Text>
              <Text type="supporting"><time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time></Text>
            </VStack>
            <Button label={`Undo: ${label}`} size="sm" variant="secondary" isDisabled={busy} onClick={() => undo(id)} />
          </HStack>
        ))}
      </VStack>
    </Collapsible>
  );
}
