import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition } from '@trailmap/shared';
import { useState } from 'react';
import { correct } from '../../corrections/client';
import { MY_NOTES_LIMIT } from '../../corrections/messages';
import { FieldNotesMarkdown } from '../../wrapup/FieldNotesMarkdown';

/** The user's own words about this Expedition. Generated field notes never replace them. */
export function MyNotesPane({ expedition }: { expedition: Expedition }) {
  const { id, myNotes } = expedition;
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const tooLong = (draft?.length ?? 0) > MY_NOTES_LIMIT;

  async function save() {
    if (draft === undefined || tooLong || saving) return;
    setSaving(true);
    setError(false);
    const ok = await correct('my-notes', { expeditionId: id, text: draft });
    setSaving(false);
    if (ok === true) setDraft(undefined);
    else setError(true);
  }

  return (
    <VStack as="section" gap={3} aria-label="My notes">
      <HStack align="center" justify="between" wrap="wrap" gap={2}>
        <Heading level={2}>My notes</Heading>
        {draft === undefined && <Button label={myNotes ? 'Edit my notes' : 'Write my notes'} size="sm" onClick={() => setDraft(myNotes ?? '')} />}
      </HStack>
      {draft === undefined ? (
        myNotes ? <FieldNotesMarkdown>{myNotes}</FieldNotesMarkdown> : (
          <Text type="supporting">No notes yet. What you write here helps build your concepts, Atlas and threads. The generated field notes below never replace it.</Text>
        )
      ) : (
        <>
          <TextArea label="My notes Markdown" value={draft} onChange={setDraft} rows={10} isReadOnly={saving}
            description="Sent to your model to find the concepts you learned, unless you turn that off in Settings."
            status={tooLong ? { type: 'error', message: 'My notes are too long to save.' } : undefined} hasAutoFocus />
          {error && <Text role="alert">Could not save my notes. Your draft is still here.</Text>}
          <HStack gap={2} justify="end" wrap="wrap">
            <Button label="Cancel" size="sm" isDisabled={saving} onClick={() => { setDraft(undefined); setError(false); }} />
            <Button label="Save my notes" size="sm" variant="primary" isDisabled={tooLong || saving} onClick={() => void save()} />
          </HStack>
        </>
      )}
    </VStack>
  );
}
