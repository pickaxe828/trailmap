import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Thread } from '@trailmap/shared';
import { useCallback, useState } from 'react';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { formatExpeditionDate, threadHref } from '../../journal/links';
import { correctThread } from '../../threads/messages';
import { readThread } from '../../threads/read';
import { JOURNAL_PATH } from '../../ui/TrailmapNavigation';
import { TrailmapShell } from '../../ui/TrailmapShell';
import { FieldNotesMarkdown } from '../../wrapup/FieldNotesMarkdown';
import { SessionTimeline } from './SessionTimeline';
import { ThreadDialog, type ThreadDialogAction } from './ThreadDialog';

function LivingNote({ thread }: { thread: Thread }) {
  return (
    <VStack as="section" gap={2} aria-label="Living note">
      <Heading level={2}>Living note</Heading>
      {thread.livingNote ? <FieldNotesMarkdown>{thread.livingNote}</FieldNotesMarkdown>
        : <Text type="supporting">The living note will appear here as session field notes are combined.</Text>}
    </VStack>
  );
}

export function App() {
  const id = new URLSearchParams(window.location.search).get('id');
  const read = useCallback((db: TrailmapDb) => id ? readThread(db, id) : Promise.resolve(null), [id]);
  const result = useJournalData(read);
  const review = result?.data;
  const thread = review?.thread;
  const [action, setAction] = useState<ThreadDialogAction>();
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState(false);

  async function markDone(threadId: string) {
    setMarking(true);
    setError(false);
    const updated = await correctThread({ action: 'done', threadId });
    setError(!updated);
    setMarking(false);
  }
  return (
    <TrailmapShell journalDetail title={thread?.title ?? 'Thread'}
      description={thread?.question && thread.question !== thread.title
        ? thread.question : 'Follow related expeditions and their living note.'}
      actions={review && <HStack gap={2} wrap="wrap">
        <Button label="Rename thread" size="sm" onClick={() => setAction({ kind: 'rename' })} />
        {review.otherThreads.length > 0 && <Button label="Merge threads" size="sm" onClick={() => setAction({ kind: 'merge' })} />}
        {review.sessions.length > 2 && <Button label="Split thread" size="sm" onClick={() => setAction({ kind: 'split' })} />}
        {review.thread.status !== 'done' && <Button label="Mark done" size="sm" isDisabled={marking} onClick={() => void markDone(review.thread.id)} />}
      </HStack>}>
      {thread && <HStack gap={2} wrap="wrap">
        <Text type="supporting">Last active {formatExpeditionDate(thread.lastActiveAt)}</Text>
        <Text type="label">{({ active: 'Active', dormant: 'Dormant', done: 'Done' } as const)[thread.status]}</Text>
      </HStack>}
      {error && <Text role="alert">Could not mark this thread done.</Text>}
      {!result && <Text>Loading thread…</Text>}
      {result?.error && <Text role="alert">Could not load this thread. Try reloading the page.</Text>}
      {result && !result.error && !review && <Text>This thread no longer exists.</Text>}
      {review && (
        <VStack gap={4} className="lg:grid! lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
          <VStack as="aside" className="min-w-0 lg:col-start-2 lg:row-start-1">
            <Card padding={4}><LivingNote thread={review.thread} /></Card>
          </VStack>
          <VStack className="min-w-0 lg:col-start-1 lg:row-start-1">
            <SessionTimeline sessions={review.sessions} recurrences={review.recurrences}
              onDetach={(id) => setAction({ kind: 'detach', id })} />
          </VStack>
        </VStack>
      )}
      {review && action && <ThreadDialog action={action} review={review} onClose={() => setAction(undefined)}
        onApplied={(destination) => {
          setAction(undefined);
          if (destination !== id) window.location.assign(destination ? threadHref(destination) : JOURNAL_PATH);
        }} />}
    </TrailmapShell>
  );
}
