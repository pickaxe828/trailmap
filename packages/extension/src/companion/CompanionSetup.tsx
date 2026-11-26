import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { CompanionStatus } from './client';
import { COMPANION_RECONNECT_MESSAGE } from './status';

export function CompanionSetup({ companion }: { companion: CompanionStatus }) {
  return (
    <VStack gap={2} hAlign="start">
      <Text as="p">The companion runs on your computer. AI notes and Obsidian sync need it; recording and trails don’t.</Text>
      <Text role="status" weight="semibold">
        {companion.state === 'connected' ? 'Companion connected' : 'Waiting for the companion…'}
      </Text>
      {companion.state !== 'connected' && (
        <>
          <Text as="p">With the companion on your PATH, run this in a terminal:</Text>
          <Code>trailmap-companion install</Code>
          <Text as="p" type="supporting">
            From a Trailmap checkout, run <Code>bun run build:companion</Code> first, then run{' '}
            <Code>packages/companion/dist/trailmap-companion install</Code> from the repo root.
            Trailmap will detect the connection automatically.
          </Text>
          <Button label="Check connection" size="sm" variant="secondary"
            clickAction={async () => { await chrome.runtime.sendMessage({ type: COMPANION_RECONNECT_MESSAGE }).catch(() => {}); }} />
        </>
      )}
    </VStack>
  );
}
