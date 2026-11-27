import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition } from '@trailmap/shared';
import { useEffect } from 'react';
import { openTrailmapDb } from '../../db/db';
import { markNotesSeen } from '../../wrapup/badge';
import { displayFieldNotes } from '../../wrapup/markdown';
import { FieldNotesMarkdown } from '../../wrapup/FieldNotesMarkdown';

export function FieldNotesPane({ expedition }: { expedition: Expedition }) {
  const { id, kind, fieldNotes, unseenNotes, notesWrittenAt } = expedition;

  useEffect(() => {
    if (!fieldNotes || !unseenNotes) return;
    const db = openTrailmapDb();
    void markNotesSeen(db, id).catch(() => {}).finally(() => db.close());
  }, [id, fieldNotes, unseenNotes, notesWrittenAt]);

  return (
    <VStack as="section" gap={3} aria-label="Field notes">
      <Heading level={2}>Field notes</Heading>
      <Text type="supporting">Written by your model from the pages you read. They update on their own and are separate from My notes.</Text>
      {kind !== 'learning' ? <Text type="supporting">Mark this expedition as learning to generate field notes.</Text> : (
        fieldNotes ? <FieldNotesMarkdown>{displayFieldNotes(expedition) ?? ''}</FieldNotesMarkdown> : <Text type="supporting">No field notes yet.</Text>
      )}
    </VStack>
  );
}
