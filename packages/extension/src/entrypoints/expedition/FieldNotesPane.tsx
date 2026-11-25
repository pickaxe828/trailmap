import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import { correct } from '../../corrections/client';
import { FIELD_NOTES_LIMIT } from '../../corrections/messages';
import { openTrailmapDb } from '../../db/db';
import { markNotesSeen } from '../../wrapup/badge';
import { FieldNotesMarkdown } from '../../wrapup/FieldNotesMarkdown';

export function FieldNotesPane({ expedition }: { expedition: Expedition }) {
  const { id, kind, fieldNotes, unseenNotes, notesWrittenAt } = expedition;
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const tooLong = (draft?.length ?? 0) > FIELD_NOTES_LIMIT;

  useEffect(() => {
    if (!fieldNotes || !unseenNotes) return;
    const db = openTrailmapDb();
    void markNotesSeen(db, id).catch(() => {}).finally(() => db.close());
  }, [id, fieldNotes, unseenNotes, notesWrittenAt]);

  async function save() {
    if (draft === undefined || tooLong || saving) return;
    setSaving(true);
    setError(false);
    const ok = await correct('field-notes', { expeditionId: id, text: draft });
    setSaving(false);
    if (ok === true) setDraft(undefined);
    else setError(true);
  }

  return (
    <VStack as="section" gap={3} aria-label="Field notes">
      <HStack align="center" justify="between" wrap="wrap" gap={2}>
        <Heading level={2}>Field notes</Heading>
        {draft === undefined && <Button label="Edit field notes" size="sm" onClick={() => setDraft(fieldNotes ?? '')} />}
      </HStack>
      {draft === undefined ? (
        fieldNotes ? <FieldNotesMarkdown>{fieldNotes}</FieldNotesMarkdown> : (
          <Text type="supporting">{kind === 'errand' ? 'Field notes aren’t generated for errands.' : 'No field notes yet.'}</Text>
        )
      ) : (
        <>
          <TextArea label="Field notes Markdown" value={draft} onChange={setDraft} rows={12} isReadOnly={saving}
            status={tooLong ? { type: 'error', message: 'Field notes are too long to save.' } : undefined} hasAutoFocus />
          {error && <Text role="alert">Could not save field notes. Your draft is still here.</Text>}
          <HStack gap={2} justify="end" wrap="wrap">
            <Button label="Cancel" isDisabled={saving} onClick={() => { setDraft(undefined); setError(false); }} />
            <Button label="Save field notes" variant="primary" isDisabled={tooLong || saving} onClick={() => void save()} />
          </HStack>
        </>
      )}
    </VStack>
  );
}
