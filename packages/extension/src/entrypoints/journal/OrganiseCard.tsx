import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Popover } from '@astryxdesign/core/Popover';
import { VStack } from '@astryxdesign/core/VStack';
import { useMemo, useState, type ReactNode } from 'react';
import type { OrganisationPlan } from '../../journal/organise';

const dragType = 'application/x-trailmap-expedition';
export type DropChoice = { label: string; plan: OrganisationPlan };

export function OrganiseCard({ id, title, children, suggestions, selecting, checked, busy, toggle, canDrag, dropChoices, run }: {
  id: string; title: string; children: ReactNode; suggestions?: ReactNode; selecting: boolean; checked: boolean;
  busy: boolean; toggle: (id: string) => void; canDrag: boolean;
  dropChoices: (source: string) => DropChoice[]; run: (plan: OrganisationPlan) => Promise<boolean>;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const anchorRef = useMemo(() => anchor ? { current: anchor } : undefined, [anchor]);
  const [source, setSource] = useState<string>();
  const choices = source ? dropChoices(source) : [];
  return (
    <VStack gap={2} className="h-full min-w-0">
      {selecting && <CheckboxInput label={`Select ${title}`} value={checked} isDisabled={busy} onChange={() => toggle(id)} />}
      <VStack as="article" ref={setAnchor} draggable={canDrag && !busy} className={canDrag ? 'min-h-0 flex-1 cursor-grab' : 'min-h-0 flex-1'}
        onClickCapture={(event) => {
          if (!(selecting || event.shiftKey || event.metaKey || event.ctrlKey) || busy) return;
          event.preventDefault();
          event.stopPropagation();
          toggle(id);
        }}
        onDragStart={(event) => {
          if (!canDrag || busy) { event.preventDefault(); return; }
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(dragType, id);
        }}
        onDragOver={(event) => {
          if (!busy && event.dataTransfer.types.includes(dragType)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes(dragType)) return;
          event.preventDefault();
          const from = event.dataTransfer.getData(dragType);
          if (!busy && from !== id && dropChoices(from).length) setSource(from);
        }}>
        <Card padding={0} className="flex-1">
          <VStack className="h-full">
            <VStack className="flex-1">{children}</VStack>
            {suggestions && <VStack padding={4} className="pt-0">{suggestions}</VStack>}
          </VStack>
        </Card>
      </VStack>
      {anchorRef && <Popover label="Organise dropped card" anchorRef={anchorRef} isOpen={choices.length > 0}
        onOpenChange={(open) => { if (!open) setSource(undefined); }} content={
          <VStack gap={1}>
            {choices.map(({ label, plan }) => <Button key={label} label={label} size="sm" isDisabled={busy}
              onClick={() => void run(plan).then((saved) => { if (saved) setSource(undefined); })} />)}
            <Button label="Cancel" size="sm" onClick={() => setSource(undefined)} />
          </VStack>
        } />}
    </VStack>
  );
}
