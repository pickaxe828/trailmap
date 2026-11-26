import { Banner } from '@astryxdesign/core/Banner';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { SETUP_INSTRUCTIONS_PATH } from '../../companion/status';
import { useCompanionStatus } from '../../companion/useCompanionStatus';
import { SummarizePage } from './SummarizePage';

export function CompanionStatus() {
  const status = useCompanionStatus();
  if (status.state === 'connecting') return <Text role="status" type="supporting">Checking companion…</Text>;
  if (status.state === 'connected') {
    return (
      <VStack gap={2}>
        <Text role="status" type="supporting">Companion connected</Text>
        <SummarizePage />
      </VStack>
    );
  }
  return (
    <Banner status="warning" title="Companion not connected"
      description="Trails still work. AI notes and Obsidian sync need the companion."
      endContent={<Link hasUnderline href={SETUP_INSTRUCTIONS_PATH} target="_blank">Fix connection</Link>} />
  );
}
