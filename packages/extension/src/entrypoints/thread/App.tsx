import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import type { Thread } from '@trailmap/shared';
import { useCallback, useState } from 'react';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { formatExpeditionDate, threadHref } from '../../journal/links';
import { correctThread } from '../../threads/messages';
import { readThread } from '../../threads/read';
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
  const journal = chrome.runtime.getURL('/journal.html');
  const wide = useMediaQuery('(min-width: 64rem)');
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
    <>
      <Layout height="fill" contentWidth="72rem" defaultHasDividers
        header={(
          <LayoutHeader padding={4} hasDivider>
            <HStack gap={4} justify="between" align="end" wrap="wrap">
              <VStack gap={1}>
                <Link hasUnderline href={journal}>Journal</Link>
                <Heading level={1}>{thread?.title ?? 'Thread'}</Heading>
                {thread?.question && thread.question !== thread.title && <Text>{thread.question}</Text>}
                {thread && <HStack gap={2} wrap="wrap">
                  <Text type="supporting">Last active {formatExpeditionDate(thread.lastActiveAt)}</Text>
                  <Text type="label">{({ active: 'Active', dormant: 'Dormant', done: 'Done' } as const)[thread.status]}</Text>
                </HStack>}
              </VStack>
              {review && <VStack gap={1}>
                <HStack gap={2} wrap="wrap">
                  <Button label="Rename thread" size="sm" onClick={() => setAction({ kind: 'rename' })} />
                  {review.otherThreads.length > 0 && <Button label="Merge threads" size="sm" onClick={() => setAction({ kind: 'merge' })} />}
                  {review.sessions.length > 2 && <Button label="Split thread" size="sm" onClick={() => setAction({ kind: 'split' })} />}
                  {review.thread.status !== 'done' && <Button label="Mark done" size="sm" isDisabled={marking} onClick={() => void markDone(review.thread.id)} />}
                </HStack>
                {error && <Text role="alert">Could not mark this thread done.</Text>}
              </VStack>}
            </HStack>
          </LayoutHeader>
        )}
        content={(
          <LayoutContent role="main" padding={4}>
            <VStack gap={4} className="min-w-0">
              {!result && <Text>Loading thread…</Text>}
              {result?.error && <Text role="alert">Could not load this thread. Try reloading the page.</Text>}
              {result && !result.error && !review && <Text>This thread no longer exists.</Text>}
              {review && !wide && <LivingNote thread={review.thread} />}
              {review && <SessionTimeline sessions={review.sessions} recurrences={review.recurrences}
                onDetach={(id) => setAction({ kind: 'detach', id })} />}
            </VStack>
          </LayoutContent>
        )}
        end={wide && thread ? <LayoutPanel width="20rem" padding={4} hasDivider role="complementary"><LivingNote thread={thread} /></LayoutPanel> : undefined}
      />
      {review && action && <ThreadDialog action={action} review={review} onClose={() => setAction(undefined)}
        onApplied={(destination) => {
          setAction(undefined);
          if (destination !== id) window.location.assign(destination ? threadHref(destination) : journal);
        }} />}
    </>
  );
}
