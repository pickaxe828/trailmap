import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition } from '@trailmap/shared';
import { useState } from 'react';
import { openTrailmapDb } from '../../db/db';
import { markNotesSeen } from '../../wrapup/badge';
import { displayFieldNotes } from '../../wrapup/markdown';
import { FieldNotesMarkdown } from '../../wrapup/FieldNotesMarkdown';

let db: ReturnType<typeof openTrailmapDb> | undefined;

/** Wrapped-up Expeditions: the title and question right away, field notes once written. Opening notes marks them seen. */
export function FieldNotes({ expeditions }: { expeditions: Expedition[] }) {
  const [open, setOpen] = useState<string>();
  if (!expeditions.length) return null;
  function toggle({ id }: Expedition, isOpen: boolean) {
    setOpen(isOpen ? id : undefined);
    if (isOpen) void markNotesSeen(db ??= openTrailmapDb(), id).catch(() => {});
  }
  return (
    <VStack gap={2}>
      <Heading level={2}>Field notes</Heading>
      {expeditions.map((expedition) => {
        const { id, title, drivingQuestion, fieldNotes, kind, unseenNotes } = expedition;
        const heading = <Text weight="semibold">{unseenNotes ? `${title} (new)` : title}</Text>;
        if (!fieldNotes) {
          return (
            <VStack key={id} gap={1}>
              {heading}
              <Text type="supporting">
                {kind === 'errand' ? 'Not learning — no field notes.' : kind === 'unclassified' ? 'Mark as learning in the Journal to generate field notes.' : drivingQuestion ?? 'Writing notes…'}
              </Text>
            </VStack>
          );
        }
        return (
          <Collapsible key={id} isOpen={open === id} onOpenChange={(isOpen) => toggle(expedition, isOpen)}
            trigger={<HStack gap={2} align="center">{heading}</HStack>}>
            <FieldNotesMarkdown>{displayFieldNotes(expedition) ?? ''}</FieldNotesMarkdown>
          </Collapsible>
        );
      })}
    </VStack>
  );
}
