import { Heading } from '@astryxdesign/core/Heading';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { reviewEnabled, saveReviewSettings } from './settings';
import { useReviewSettings } from './useReviewSettings';

/** The two opt-ins for concept review. Both are off until the user turns them on. */
export function ReviewSettingsPanel() {
  const settings = useReviewSettings();
  const [error, setError] = useState(false);

  async function save(next: NonNullable<typeof settings>) {
    setError(false);
    try { await saveReviewSettings(next); } catch { setError(true); }
  }

  return (
    <VStack as="section" id="review" gap={3}>
      <Heading level={2}>Concept review</Heading>
      <Text as="p" type="supporting">
        Review brings back the concepts you learned, and any you star on the Atlas, on a spaced-repetition schedule (FSRS) that is kept
        only on this computer. A card shows the concept’s name; its answer is the stored gloss and one snippet from your own pages or
        notes. Nothing is sent anywhere. Concepts you hid with “I didn’t learn this” never get a card, and Forget removes the cards of
        what it forgets.
      </Text>
      <Switch size="sm" label="Review concepts I have learned" value={settings ? reviewEnabled(settings) : false} isDisabled={settings === undefined}
        description="Adds Review to the top bar. Off by default." changeAction={(enabled) => save({ ...settings, enabled })} />
      <Text as="p" type="supporting">
        Optionally, a model can write a question for each card. This sends the concept’s name, gloss and snippet (only for concepts whose
        every source may go to a model) to your chosen model provider, and each request is listed in the Sent-to-model log.
      </Text>
      <Switch size="sm" label="Write question cards with a model" value={settings?.modelQuestions === true}
        isDisabled={settings === undefined || !reviewEnabled(settings)} description="Off by default. Needs review to be on."
        changeAction={(modelQuestions) => save({ ...settings, modelQuestions })} />
      {error && <Text role="alert">Could not save the review setting.</Text>}
    </VStack>
  );
}
