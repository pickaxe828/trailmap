import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { formatExpeditionDate } from '../../journal/links';
import { correctThread, type ThreadAction } from '../../threads/messages';
import type { ThreadReview } from '../../threads/read';

export type ThreadDialogAction = { kind: 'rename' | 'merge' | 'split' } | { kind: 'detach'; id: string };
const labels = { rename: ['Rename thread', 'Rename'], merge: ['Merge threads', 'Merge'],
  split: ['Split thread', 'Split'], detach: ['Detach session', 'Detach'] } as const;

export function ThreadDialog({ action, review, onClose, onApplied }: {
  action: ThreadDialogAction; review: ThreadReview; onClose: () => void; onApplied: (id: string | null) => void;
}) {
  const { thread, sessions, otherThreads } = review;
  const [value, setValue] = useState(action.kind === 'rename' ? thread.title : '');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [title, saveLabel] = labels[action.kind];
  const session = action.kind === 'detach' ? sessions.find(({ expedition }) => expedition.id === action.id)?.expedition : undefined;
  const valid = action.kind === 'rename' ? !!value.trim() && value.trim() !== thread.title && value.trim().length <= 120
    : action.kind === 'merge' ? otherThreads.some(({ id }) => id === value)
      : action.kind === 'split' ? selected.length >= 2 && selected.length < sessions.length : !!session;
  const close = () => { if (!saving) onClose(); };
  async function save() {
    if (!valid || saving) return;
    const threadId = thread.id;
    const input: ThreadAction = action.kind === 'rename' ? { action: 'rename', threadId, title: value }
      : action.kind === 'merge' ? { action: 'merge', threadId, sourceId: value }
        : action.kind === 'split' ? { action: 'split', threadId, expeditionIds: selected }
          : { action: 'detach', threadId, expeditionId: session!.id };
    setSaving(true);
    setError(false);
    const result = await correctThread(input);
    setSaving(false);
    if (result) onApplied(result.threadId);
    else setError(true);
  }
  return (
    <Dialog isOpen onOpenChange={close} purpose="form">
      <DialogHeader title={title} onOpenChange={close} />
      <VStack gap={3} padding={4}>
        {action.kind === 'rename' && <TextInput label="Thread name" value={value} onChange={setValue}
          onEnter={() => void save()} isReadOnly={saving} hasAutoFocus />}
        {action.kind === 'merge' && <>
          <Text>Bring another thread’s sessions into this one.</Text>
          <Selector label="Thread to merge" options={otherThreads.map(({ id, title }) => ({ value: id, label: title }))}
            placeholder="Choose a thread" value={value} onChange={setValue} isReadOnly={saving} width="100%" />
        </>}
        {action.kind === 'split' && <CheckboxList label="Sessions to move" value={selected} onChange={setSelected} isReadOnly={saving}
          description="Choose at least two sessions for a new thread. If only one session remains, it will return to the Journal on its own.">
          {sessions.map(({ expedition }) => <CheckboxListItem key={expedition.id} value={expedition.id} label={expedition.title}
            description={formatExpeditionDate(expedition.startedAt)} />)}
        </CheckboxList>}
        {session && <Text>Return “{session.title}” to the Journal on its own.
          {sessions.length === 2 && ' The other session will also return to the Journal on its own.'}</Text>}
        {error && <Text role="alert">Could not apply this correction. The thread may have changed.</Text>}
        <HStack gap={2} justify="end">
          <Button label="Cancel" isDisabled={saving} onClick={close} />
          <Button label={saveLabel} variant="primary" isDisabled={!valid || saving} onClick={() => void save()} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
