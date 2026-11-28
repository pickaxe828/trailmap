import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createNoteAutosave, type SaveStatus } from '../../notes/autosave';

/** Mount with a key that identifies the Visit (and Expedition, for My notes). */
export function NoteEditor({ label, stored, limit, save }: {
  label: string;
  stored: string;
  limit: number;
  save: (text: string, sessionId: string) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<SaveStatus>();
  const [draft, setDraft] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [editor] = useState(() => createNoteAutosave({ save, report: setStatus }));

  useLayoutEffect(() => {
    window.addEventListener('pagehide', editor.finish);
    return () => { window.removeEventListener('pagehide', editor.finish); editor.finish(); };
  }, [editor]);

  // While typing, keep the caret and whitespace. Once Dexie reflects the save, follow live data again (including Undo).
  useEffect(() => {
    if (!focused && status === 'saved' && draft?.trim() === stored) setDraft(undefined);
  }, [draft, focused, status, stored]);

  return (
    <VStack gap={1}>
      <TextArea size="sm" rows={4} label={label} placeholder="Write a note…"
        ref={(el) => { if (el) el.maxLength = limit; }} value={draft ?? stored}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); editor.finish(); }}
        onChange={(text) => { setDraft(text); editor.change(text); }} />
      <Text type="supporting" role="status">
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved'
          : status === 'failed' ? 'Could not save this note.' : 'Markdown supported · Saves automatically'}
      </Text>
    </VStack>
  );
}
