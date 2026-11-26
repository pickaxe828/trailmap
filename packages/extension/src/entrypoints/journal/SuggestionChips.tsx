import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Token } from '@astryxdesign/core/Token';
import type { Expedition, SuggestionTarget } from '@trailmap/shared';
import type { ReactNode } from 'react';
import type { JournalAction } from '../../journal/messages';
import { planOrganisation } from '../../journal/organise';
import type { ThreadTarget } from '../../threads/read';

export function SuggestionChips({ expedition, group, merges, busy, run }: {
  expedition: Expedition; group?: ThreadTarget; merges?: Expedition[];
  busy: boolean; run: (action: JournalAction) => Promise<boolean>;
}) {
  function chip(label: string, verb: string, action: JournalAction, target?: SuggestionTarget): ReactNode {
    return <Token key={target ? `${verb}:${target.kind}:${target.id}` : verb} className="max-w-full" size="sm" label={label} endContent={
      <HStack gap={0.5} align="center">
        <Button label={verb} aria-label={`${verb}: ${label}`} size="sm" variant="ghost" isDisabled={busy} onClick={() => void run(action)} />
        {target && <Button label="Dismiss" aria-label={`Dismiss: ${label}`} size="sm" variant="ghost" isDisabled={busy}
          onClick={() => void run({ action: 'dismiss', expeditionId: expedition.id, target })} />}
      </HStack>
    } />;
  }
  const chips = [];
  if (expedition.kind === 'unclassified') {
    const plan = planOrganisation([expedition], { action: 'classify', kind: 'learning' });
    if (plan) chips.push(chip('Mark as learning?', 'Mark as learning', plan));
  }
  if (group) {
    const target = { id: group.id, kind: group.kind };
    chips.push(chip(`Part of ${group.title}?`, 'Add', { action: 'accept', expeditionId: expedition.id, target }, target));
  }
  for (const other of merges ?? []) {
    const plan = planOrganisation([expedition, other], { action: 'merge' });
    if (plan) chips.push(chip(`Same topic as ${other.title}?`, 'Merge', plan, { kind: 'expedition', id: other.id }));
  }
  return chips.length ? <HStack gap={1} wrap="wrap">{chips}</HStack> : null;
}
