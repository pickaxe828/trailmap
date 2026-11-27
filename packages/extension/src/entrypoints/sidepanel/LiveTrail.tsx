import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { TreeList, type TreeListItemData } from '@astryxdesign/core/TreeList';
import { VStack } from '@astryxdesign/core/VStack';
import type { Expedition, Visit } from '@trailmap/shared';
import { useState } from 'react';
import { siteKey } from '../../privacy/policy';
import { formatActiveTime } from '../../trail/format';
import { buildTrail, type TrailNode } from '../../trail/tree';
import type { useLiveTrail } from '../../trail/useLiveTrail';
import { WRAP_UP_MESSAGE } from '../../wrapup/messages';
import { correct } from '../../corrections/client';
import { expeditionHref } from '../../journal/links';
import type { PriorRead } from '../../threads/picking-up';
import { useSiteSkipped } from './corrections-client';

const readDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

type Trail = NonNullable<ReturnType<typeof useLiveTrail>>;
type Open = Trail['open'][number];

type Dialogue =
  | { kind: 'note'; visit: Visit }
  | { kind: 'rename'; expedition: Expedition }
  | { kind: 'forget-page'; visit: Visit }
  | { kind: 'forget-site'; host: string }
  | { kind: 'forget-expedition'; expedition: Expedition };

const hostOf = (url: string) => siteKey(url) ?? url;

/** The open Expeditions as small trees with a "you are here" marker, plus today's other Visits. One-click fixes live on each row. */
export function LiveTrail({ trail, currentVisitId, priorReads }: {
  trail: Trail; currentVisitId: string | null; priorReads?: ReadonlyMap<string, PriorRead>;
}) {
  const isSkipped = useSiteSkipped();
  const [dialogue, setDialogue] = useState<Dialogue>();
  const [failed, setFailed] = useState(false);
  const [todayMenu, setTodayMenu] = useState<{ visitId: string; anchorPath: Set<string> }>();

  // Segmentation can move a Visit (or one of its ancestors) out of Today while
  // its menu is open. Keep that anchor in the same tree until dismissal, but
  // use fresh rows so edits and Forget are still reflected immediately.
  const moved = todayMenu ? trail.open.flatMap(({ visits }) => visits)
    .filter(({ id }) => todayMenu.anchorPath.has(id)) : [];
  const today = [...trail.today, ...moved];
  const currentGroup = trail.open.find(({ visits }) => visits.some(({ id }) => id === currentVisitId));
  const open = currentGroup ? [currentGroup, ...trail.open.filter((group) => group !== currentGroup)] : trail.open;
  const heldIds = todayMenu && today.some(({ id }) => id === todayMenu.visitId)
    ? new Set(moved.map(({ id }) => id)) : undefined;

  function trackTodayMenu(visit: Visit, open: boolean) {
    if (!open) {
      setTodayMenu((menu) => menu?.visitId === visit.id ? undefined : menu);
      return;
    }
    const anchorPath = new Set([visit.id]);
    for (let parentId = visit.parentVisitId; parentId && !anchorPath.has(parentId);) {
      const parent = today.find(({ id }) => id === parentId);
      if (!parent) break;
      anchorPath.add(parentId);
      parentId = parent.parentVisitId;
    }
    setTodayMenu({ visitId: visit.id, anchorPath });
  }

  async function run(promise: Promise<boolean | string | null>) {
    const ok = await promise;
    setFailed(ok === false);
    setDialogue(undefined);
  }

  function toItem({ visit, children }: TrailNode, group?: Open): TreeListItemData {
    const here = visit.id === currentVisitId;
    const others = trail.open.filter(({ expedition }) => expedition.id !== group?.expedition.id);
    const host = hostOf(visit.url);
    const note = trail.notes[visit.id];
    const prior = priorReads?.get(visit.id);
    return {
      id: visit.id,
      label: (
        <VStack gap={0.5}>
          <HStack gap={1} align="center" wrap="wrap">
            <Text display="block" maxLines={2} className="min-w-0" weight={here ? 'semibold' : undefined}>{visit.title || visit.url}</Text>
            {here && <Text type="supporting">You are here</Text>}
            {visit.starred && <Text type="supporting">Key page</Text>}
            {prior && <Token size="sm" label={`Read on ${readDate.format(prior.at)}`} />}
          </HStack>
          {prior?.summary && <Text type="supporting">{prior.summary}</Text>}
        </VStack>
      ),
      description: [`${host} · ${visit.transition} · ${formatActiveTime(visit.activeMs)}`, note && `Note: ${note}`]
        .filter(Boolean).join(' · '),
      children: children.length > 0 ? children.map((child) => toItem(child, group)) : undefined,
      isExpanded: true,
      endContent: (
        <HStack gap={1} align="center" className="shrink-0">
          <Button size="sm" label={visit.starred ? 'Unstar page' : 'Star page'}
            tooltip={visit.starred ? 'Remove key page' : 'Mark as a key page'}
            clickAction={() => run(correct('star', { visitId: visit.id, starred: !visit.starred }))} />
          <MoreMenu size="sm" alignment="end" label={`Actions for ${visit.title || host}`}
            onOpenChange={group ? undefined : (open) => trackTodayMenu(visit, open)} items={[
            ...(visit.aiConversation && visit.expeditionId ? [{ label: 'View AI conversation',
              onClick: () => { void chrome.tabs.create({ url: expeditionHref(visit.expeditionId!, visit.id) }); },
            }] : []),
            { label: note ? 'Edit note' : 'Add note', onClick: () => setDialogue({ kind: 'note', visit }) },
            ...(group && group.expedition.rootVisitId !== visit.id ? [{
              label: 'Split expedition here', onClick: () => void run(correct('split', { visitId: visit.id })),
            }] : []),
            ...(group ? others.map(({ expedition }) => ({
              label: `Move to ${expedition.title}`,
              onClick: () => void run(correct('move', { visitId: visit.id, toExpeditionId: expedition.id })),
            })) : []),
            { type: 'divider' as const },
            {
              label: isSkipped(visit.url) ? `${host} is ignored` : `Ignore ${host}`, isDisabled: isSkipped(visit.url),
              onClick: () => void run(correct('ignore-site', { visitId: visit.id })),
            },
            { type: 'divider' as const },
            { label: visit.aiConversation ? 'Forget AI conversation' : 'Forget page', variant: 'destructive' as const,
              onClick: () => setDialogue({ kind: 'forget-page', visit }) },
            { label: `Forget ${host}`, variant: 'destructive' as const, onClick: () => setDialogue({ kind: 'forget-site', host }) },
          ]} />
        </HStack>
      ),
    };
  }

  return (
    <VStack gap={2}>
      {failed && <Text type="supporting">That correction could not be applied.</Text>}
      {trail.open.length > 0 && (
        <VStack gap={2}>
          <Heading level={2}>Open expeditions</Heading>
          {open.map((group) => {
            const { expedition, visits } = group;
            const others = trail.open.filter((other) => other.expedition.id !== expedition.id);
            return (
              <TreeList key={expedition.id}
                header={
                  <HStack gap={1} align="center" justify="between">
                    <Heading level={3} maxLines={2} className="min-w-0">{expedition.title}</Heading>
                    <HStack gap={1} align="center" className="shrink-0">
                    <Button size="sm" label="Wrap up" aria-label={`Wrap up expedition ${expedition.title}`}
                      clickAction={async () => { await chrome.runtime.sendMessage({ type: WRAP_UP_MESSAGE, expeditionId: expedition.id }).catch(() => {}); }} />
                    <MoreMenu size="sm" alignment="end" label={`Actions for expedition ${expedition.title}`} items={[
                      { label: 'Rename', onClick: () => setDialogue({ kind: 'rename', expedition }) },
                      ...others.map((other) => ({
                        label: `Merge into ${other.expedition.title}`,
                        onClick: () => void run(correct('merge', { intoId: other.expedition.id, fromId: expedition.id })),
                      })),
                      { type: 'divider' as const },
                      { label: 'Forget expedition', variant: 'destructive' as const,
                        onClick: () => setDialogue({ kind: 'forget-expedition', expedition }) },
                    ]} />
                    </HStack>
                  </HStack>
                }
                items={buildTrail(heldIds ? visits.filter(({ id }) => !heldIds.has(id)) : visits)
                  .map((node) => toItem(node, group))} />
            );
          })}
        </VStack>
      )}
      {(heldIds ? today : trail.today).length > 0 && (
        <TreeList header={<Heading level={2}>Today</Heading>}
          items={buildTrail(heldIds ? today : trail.today).map((node) => toItem(node))} />
      )}

      {dialogue?.kind === 'note' && (
        <TextDialog key={dialogue.visit.id} title="Note" label="Note" multiline initial={trail.notes[dialogue.visit.id] ?? ''}
          saveLabel="Save note" onClose={() => setDialogue(undefined)}
          onSave={(text) => run(correct('note', { nodeId: dialogue.visit.id, text }))} />
      )}
      {dialogue?.kind === 'rename' && (
        <TextDialog key={dialogue.expedition.id} title="Rename expedition" label="Expedition name" initial={dialogue.expedition.title}
          saveLabel="Rename" onClose={() => setDialogue(undefined)}
          onSave={(title) => run(correct('rename', { expeditionId: dialogue.expedition.id, title }))} />
      )}
      {dialogue?.kind === 'forget-page' && (
        <AlertDialog isOpen onOpenChange={() => setDialogue(undefined)} title={dialogue.visit.aiConversation ? 'Forget this AI conversation?' : 'Forget this page?'}
          description={dialogue.visit.aiConversation ? 'This permanently deletes the conversation, its cited links, and everything derived from its content.'
            : 'This permanently deletes every visit to this page and everything derived from it: its text, highlights, notes, queries and page notes.'}
          actionLabel={dialogue.visit.aiConversation ? 'Forget AI conversation' : 'Forget page'}
          onAction={() => run(correct('forget-page', { canonicalUrl: dialogue.visit.canonicalUrl }))} />
      )}
      {dialogue?.kind === 'forget-site' && (
        <AlertDialog isOpen onOpenChange={() => setDialogue(undefined)} title={`Forget ${dialogue.host}?`}
          description="This permanently deletes every page you visited on this site and everything derived from them. Recording stays on unless you also ignore the site."
          actionLabel="Forget site" onAction={() => run(correct('forget-site', { host: dialogue.host }))} />
      )}
      {dialogue?.kind === 'forget-expedition' && (
        <AlertDialog isOpen onOpenChange={() => setDialogue(undefined)} title="Forget this expedition?"
          description="This permanently deletes the expedition, all of its visits, and everything derived from them."
          actionLabel="Forget expedition"
          onAction={() => run(correct('forget-expedition', { expeditionId: dialogue.expedition.id }))} />
      )}
    </VStack>
  );
}

function TextDialog({ title, label, initial, saveLabel, multiline, onSave, onClose }: {
  title: string; label: string; initial: string; saveLabel: string; multiline?: boolean;
  onSave: (text: string) => void | Promise<void>; onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <Dialog isOpen onOpenChange={onClose} purpose="form">
      <DialogHeader title={title} onOpenChange={onClose} />
      <VStack gap={2} padding={4}>
        {multiline
          ? <TextArea label={label} value={text} onChange={setText} hasAutoFocus />
          : <TextInput label={label} value={text} onChange={setText} onEnter={() => void onSave(text)} hasAutoFocus />}
        <HStack gap={2} justify="end">
          <Button label="Cancel" onClick={onClose} />
          <Button variant="primary" label={saveLabel} clickAction={() => onSave(text)} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
