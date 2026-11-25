import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import type { Visit } from '@trailmap/shared';
import { useState } from 'react';
import { correct } from '../../corrections/client';
import type { ExpeditionReview } from '../../journal/data';
import { visitTitle } from './StopDetails';

export type ExpeditionCorrection = { kind: 'rename' } | { kind: 'merge' } | { kind: 'move'; visit: Visit };

export function CorrectionDialog({ review, action, onClose }: {
  review: ExpeditionReview; action: ExpeditionCorrection; onClose: () => void;
}) {
  const { expedition, alternatives } = review;
  const [value, setValue] = useState(action.kind === 'rename' ? expedition.title : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const rename = action.kind === 'rename';
  const merge = action.kind === 'merge';
  const title = rename ? 'Rename expedition' : merge ? 'Merge expeditions' : 'Move page';
  const saveLabel = rename ? 'Rename' : merge ? 'Merge' : 'Move page';
  const valid = rename ? !!value.trim() : alternatives.some(({ id }) => id === value);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(false);
    const ok = action.kind === 'rename' ? await correct('rename', { expeditionId: expedition.id, title: value })
      : action.kind === 'merge' ? await correct('merge', { intoId: expedition.id, fromId: value })
        : await correct('move', { visitId: action.visit.id, toExpeditionId: value });
    setSaving(false);
    if (ok === true) onClose();
    else setError(true);
  }

  const close = () => { if (!saving) onClose(); };
  return (
    <Dialog isOpen onOpenChange={close} purpose="form">
      <DialogHeader title={title} onOpenChange={close} />
      <VStack gap={3} padding={4}>
        {rename ? (
          <TextInput label="Expedition name" value={value} onChange={setValue} onEnter={() => void save()} isReadOnly={saving} hasAutoFocus />
        ) : (
          <>
            {action.kind === 'move' ? <Text>{visitTitle(action.visit)}</Text>
              : <Text>Bring another expedition’s visits into this one. This expedition keeps its title and field notes.</Text>}
            <Selector label={merge ? 'Expedition to merge' : 'Destination expedition'}
              placeholder="Choose an expedition" width="100%" options={alternatives.map(({ id, title }) => ({ value: id, label: title }))}
              value={value} onChange={setValue} hasSearch={alternatives.length > 8} isReadOnly={saving} />
          </>
        )}
        {error && <Text role="alert">Could not apply this correction. The trail may have changed.</Text>}
        <HStack gap={2} justify="end">
          <Button label="Cancel" isDisabled={saving} onClick={close} />
          <Button label={saveLabel} variant="primary" isDisabled={!valid || saving} onClick={() => void save()} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
