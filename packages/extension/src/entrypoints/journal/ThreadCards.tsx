import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition, Thread } from '@trailmap/shared';
import { useState } from 'react';
import { formatExpeditionDate, threadHref } from '../../journal/links';
import { correctThread } from '../../threads/messages';
import { isClosedLearning } from '../../threads/model';
import type { ThreadTarget } from '../../threads/read';
import { ExpeditionCard } from './ExpeditionCard';

export function ThreadCard({ thread, count }: { thread: Thread; count: number }) {
  return (
    <ClickableCard label={thread.title} href={threadHref(thread.id)} padding={4} height="100%">
      <VStack gap={2}>
        <HStack gap={2} justify="between" wrap="wrap">
          <Text type="label">Thread</Text>
          <Text type="supporting">{count} sessions{thread.status === 'done' && ' · Done'}</Text>
        </HStack>
        <Heading level={3}>{thread.title}</Heading>
        {thread.question && thread.question !== thread.title && <Text type="supporting" maxLines={2}>{thread.question}</Text>}
        <Text type="supporting">Last active {formatExpeditionDate(thread.lastActiveAt)}</Text>
      </VStack>
    </ClickableCard>
  );
}

export function StandaloneCard({ expedition, suggestion, targets }: {
  expedition: Expedition; suggestion?: ThreadTarget; targets: ThreadTarget[];
}) {
  const [choosing, setChoosing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const available = targets.filter(({ id }) => id !== expedition.id);
  const selected = available.find(({ id }) => id === value);
  const close = () => { if (!saving) setChoosing(false); };
  async function attach({ kind, id }: ThreadTarget, suggested: boolean) {
    if (saving) return;
    setSaving(true);
    setError(false);
    const result = await correctThread({ action: 'attach', expeditionId: expedition.id, target: { kind, id }, suggested });
    setSaving(false);
    if (result) setChoosing(false);
    else setError(true);
  }
  return (
    <VStack gap={2}>
      <ExpeditionCard expedition={expedition} />
      {isClosedLearning(expedition) && available.length > 0 && (
        <HStack gap={2} wrap="wrap">
          {suggestion && <Button size="sm" label={`Part of ${suggestion.title}?`} isDisabled={saving} onClick={() => void attach(suggestion, true)} />}
          <Button size="sm" variant="ghost" label="Attach to thread" isDisabled={saving}
            onClick={() => { setError(false); setValue(''); setChoosing(true); }} />
        </HStack>
      )}
      {error && !choosing && <Text role="alert">Could not attach this session. The Journal may have changed.</Text>}
      {choosing && (
        <Dialog isOpen onOpenChange={close} purpose="form">
          <DialogHeader title="Attach to thread" onOpenChange={close} />
          <VStack gap={3} padding={4}>
            <Text>Attach “{expedition.title}” to a thread, or group it with another expedition to start a thread.</Text>
            <Selector label="Destination" placeholder="Choose a thread or expedition" width="100%" value={value} onChange={setValue}
              options={available.map(({ id, title, kind }) => ({ value: id, label: title, description: kind === 'thread' ? 'Thread' : 'Expedition' }))}
              hasSearch={available.length > 8} isReadOnly={saving} />
            {error && <Text role="alert">Could not attach this session. The Journal may have changed.</Text>}
            <HStack gap={2} justify="end">
              <Button label="Cancel" onClick={close} isDisabled={saving} />
              <Button label="Attach" variant="primary" isDisabled={!selected || saving} onClick={() => selected && void attach(selected, false)} />
            </HStack>
          </VStack>
        </Dialog>
      )}
    </VStack>
  );
}
