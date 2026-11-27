import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { restoreConcept, readDismissedConcepts } from '../concepts/dismiss';
import { openTrailmapDb } from '../db/db';
import { useJournalData } from '../journal/data';

/** Concepts hidden with "I didn't learn this" on the Atlas, with a way to bring each back. */
export function HiddenConcepts() {
  const hidden = useJournalData(readDismissedConcepts);
  async function restore(id: string) {
    const db = openTrailmapDb();
    try { await restoreConcept(db, id); } finally { db.close(); }
  }
  return (
    <VStack gap={2}>
      <Heading level={3}>Concepts hidden from the Atlas</Heading>
      <Text as="p" type="supporting">You said you didn’t learn these. Their evidence is kept, and they stay hidden unless you write about them.</Text>
      {hidden?.data?.length === 0 && <Text type="supporting">No hidden concepts.</Text>}
      {hidden?.error && <Text role="alert">Could not read your hidden concepts.</Text>}
      {hidden?.data && hidden.data.length > 0 && (
        <VStack as="ul" gap={1}>
          {hidden.data.map(({ id, name }) => (
            <HStack as="li" key={id} gap={2} align="center" wrap="wrap">
              <Text>{name}</Text>
              <Button label="Show on the Atlas" aria-label={`Show ${name} on the Atlas`} size="sm" variant="secondary"
                clickAction={() => restore(id)} />
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
