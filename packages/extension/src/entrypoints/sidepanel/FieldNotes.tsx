import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition } from '@trailmap/shared';
import { useState } from 'react';
import { openTrailmapDb } from '../../db/db';
import { markNotesSeen } from '../../wrapup/badge';
import { displayFieldNotes } from '../../wrapup/markdown';
import { FieldNotesMarkdown } from '../../wrapup/FieldNotesMarkdown';

let db: ReturnType<typeof openTrailmapDb> | undefined;

/** Keep finished Expeditions available without putting them ahead of the current trail. */
export function FieldNotes({ expeditions }: { expeditions: Expedition[] }) {
  const [open, setOpen] = useState<string>();
  if (!expeditions.length) return null;
  function toggle({ id }: Expedition, isOpen: boolean) {
    setOpen(isOpen ? id : undefined);
    if (isOpen) void markNotesSeen(db ??= openTrailmapDb(), id).catch(() => {});
  }
  return (
    <Collapsible defaultIsOpen={false} trigger={<Text weight="semibold">Finished expeditions · Field notes</Text>}>
      <VStack gap={2}>
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
            <Collapsible key={id} isOpen={open === id} onOpenChange={(isOpen) => toggle(expedition, isOpen)} trigger={heading}>
              <FieldNotesMarkdown>{displayFieldNotes(expedition) ?? ''}</FieldNotesMarkdown>
            </Collapsible>
          );
        })}
      </VStack>
    </Collapsible>
  );
}
