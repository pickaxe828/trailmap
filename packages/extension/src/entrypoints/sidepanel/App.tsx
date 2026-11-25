import { Heading } from '@astryxdesign/core/Heading';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';

/** Side panel ("Live trail"). Placeholder: later tickets grow the trail tree here. */
export function App() {
  return (
    <VStack gap={3} padding={4}>
      <Heading level={1}>Trailmap</Heading>
      <HStack gap={2} align="center">
        <StatusDot variant="success" label="Recording" isPulsing />
        <Text>Recording is on</Text>
      </HStack>
      <Text type="supporting">Your trail will appear here as you browse.</Text>
    </VStack>
  );
}
