import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

/** Onboarding tab, opened on first install. Placeholder: later tickets add the privacy screen and companion setup. */
export function App() {
  return (
    <VStack gap={3} padding={8} maxWidth={640}>
      <Heading level={1}>Welcome to Trailmap</Heading>
      <Text>
        Trailmap quietly turns your learning-oriented browsing into trails, field notes and a concept graph.
        Recording starts straight away.
      </Text>
      <Text type="supporting">Privacy settings and AI notes setup will appear here.</Text>
    </VStack>
  );
}
