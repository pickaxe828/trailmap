import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition, SuggestionTarget } from '@trailmap/shared';
import type { ReactNode, SVGProps } from 'react';
import type { JournalAction } from '../../journal/messages';
import { planOrganisation } from '../../journal/organise';
import type { ThreadTarget } from '../../threads/read';

// Astryx has no semantic link or merge glyphs; these are small stroke icons like TrailmapNavigation's.
function LinkIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" {...props}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>;
}
function MergeIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M6 4v6a6 6 0 0 0 6 6h0m6-12v6a6 6 0 0 1-6 6m0 0v4m-3-3 3 3 3-3" />
  </svg>;
}

export function SuggestionRows({ expedition, group, merges, busy, run }: {
  expedition: Expedition; group?: ThreadTarget; merges?: Expedition[];
  busy: boolean; run: (action: JournalAction) => Promise<boolean>;
}) {
  function row(question: string, subject: string, verb: string, glyph: typeof LinkIcon, action: JournalAction, target: SuggestionTarget): ReactNode {
    const label = `${question} ${subject}?`;
    return (
      <HStack key={`${verb}:${target.kind}:${target.id}`} role="group" aria-label={label}
        align="center" gap={2} wrap="wrap">
        <HStack align="start" gap={2} className="min-w-0 flex-1 basis-48">
          <Icon icon={glyph} size="sm" color="secondary" />
          <Text type="supporting" maxLines={2} className="min-w-0 flex-1">{question} <b>{subject}</b>?</Text>
        </HStack>
        <HStack align="center" gap={1} className="shrink-0">
          <Button label={verb} aria-label={`${verb}: ${label}`} variant="secondary" size="sm"
            isDisabled={busy} onClick={() => void run(action)} />
          <IconButton label={`Dismiss: ${label}`} icon={<Icon icon="close" />} variant="ghost" size="sm" isDisabled={busy}
            tooltip="Dismiss" onClick={() => void run({ action: 'dismiss', expeditionId: expedition.id, target })} />
        </HStack>
      </HStack>
    );
  }
  const rows = [];
  if (expedition.kind === 'unclassified') {
    const plan = planOrganisation([expedition], { action: 'classify', kind: 'learning' });
    if (plan) rows.push(
      <HStack key="classify">
        <Button label="Mark as learning" variant="secondary" size="sm" isDisabled={busy} onClick={() => void run(plan)} />
      </HStack>,
    );
  }
  if (group) {
    const target = { id: group.id, kind: group.kind };
    rows.push(row('Part of', group.title, 'Add', LinkIcon, { action: 'accept', expeditionId: expedition.id, target }, target));
  }
  for (const other of merges ?? []) {
    const plan = planOrganisation([expedition, other], { action: 'merge' });
    if (plan) rows.push(row('Same topic as', other.title, 'Merge', MergeIcon, plan, { kind: 'expedition', id: other.id }));
  }
  return rows.length ? <VStack gap={2}>{rows}</VStack> : null;
}
