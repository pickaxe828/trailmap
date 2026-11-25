import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { ChatGptConnection } from '../../ui/ChatGptConnection';
import { SETUP_INSTRUCTIONS_PATH } from '../../companion/status';
import { useCompanionStatus } from '../../companion/useCompanionStatus';
import { SummarizePage } from './SummarizePage';

/** Whether the companion (the local helper for AI features and Obsidian sync) is connected. Everything else works without it. */
export function CompanionStatus() {
  const status = useCompanionStatus();

  if (status.state === 'connected') {
    return (
      <VStack gap={2}>
        <HStack gap={2} align="center">
          <StatusDot variant="success" label="Companion connected" />
          <Text>Companion connected</Text>
        </HStack>
        <ChatGptConnection />
        <SummarizePage />
      </VStack>
    );
  }

  const checking = status.state === 'connecting';
  return (
    <VStack gap={1}>
      <HStack gap={2} align="center">
        <StatusDot variant={checking ? 'neutral' : 'warning'} label="Companion not connected" />
        <Text>Companion not connected</Text>
      </HStack>
      <Text type="supporting">
        Recording works without it; AI notes and Obsidian sync need it.{' '}
        <Link href={chrome.runtime.getURL(SETUP_INSTRUCTIONS_PATH)} target="_blank">
          Set up the companion
        </Link>
      </Text>
    </VStack>
  );
}
