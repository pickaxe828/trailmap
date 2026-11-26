import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

/** Ticket 22 (#28): replace this placeholder with the shared import flow; both onboarding and Settings render this section. */
export function HistoryImportSettings({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  return (
    <VStack as="section" id="history-import" aria-label="History import" gap={2} hAlign="start">
      <Heading level={headingLevel}>History import</Heading>
      <Text as="p" type="supporting">Importing past browsing history is not available yet. New Visits are recorded as you browse.</Text>
      <Button label="Import history" variant="secondary" isDisabled />
    </VStack>
  );
}
