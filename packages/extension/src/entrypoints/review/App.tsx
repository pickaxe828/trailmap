import { Button } from '@astryxdesign/core/Button';
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openTrailmapDb } from '../../db/db';
import { gradeConcept, pruneReview, readReviewQueue, type ReviewItem, type ReviewQueue } from '../../review/deck';
import { requestReviewQuestions } from '../../review/messages';
import { REVIEW_RATINGS, type ReviewRating } from '../../review/scheduler';
import { modelQuestionsEnabled, reviewEnabled } from '../../review/settings';
import { useReviewSettings } from '../../review/useReviewSettings';
import { expeditionHref } from '../../journal/links';
import { TrailmapShell } from '../../ui/TrailmapShell';
import { webUrl } from '../../ui/web-url';

const ratingLabels: Record<ReviewRating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
/** A card due again within the hour (an Again or Hard) comes back in this sitting. */
const SAME_SITTING_MS = 60 * 60_000;
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function load(): Promise<ReviewQueue> {
  const db = openTrailmapDb();
  try {
    await pruneReview(db);
    return await readReviewQueue(db, Date.now());
  } finally { db.close(); }
}

async function grade(conceptId: string, rating: ReviewRating) {
  const db = openTrailmapDb();
  try { return await gradeConcept(db, conceptId, rating, Date.now(), () => crypto.randomUUID()); } finally { db.close(); }
}

function Evidence({ item }: { item: ReviewItem }) {
  const { snippet } = item;
  if (!snippet) return null;
  const { source } = snippet;
  const href = source.expeditionId ? expeditionHref(source.expeditionId) : source.url ? webUrl(source.url)?.href : undefined;
  const kind = { 'my-notes': 'Your notes', note: 'Your note', highlight: 'Your highlight', page: 'Page' }[source.kind];
  return (
    <VStack gap={1}>
      <Text as="p" className="wrap-anywhere italic">“{snippet.text}”</Text>
      <Text type="supporting" className="wrap-anywhere">
        {kind}: {href ? <Link href={href} target={source.expeditionId ? undefined : '_blank'}>{source.title}</Link> : source.title}
        {source.aiGenerated ? ' (AI-generated, not an independent source)' : ''}
      </Text>
    </VStack>
  );
}

function ReviewSession({ initial, modelQuestions }: { initial: ReviewQueue; modelQuestions: boolean }) {
  const [queue, setQueue] = useState(initial.items);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(0);
  const [nextDue, setNextDue] = useState(initial.nextDue);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const current = queue[0];

  // Optional question cards: one request for the first batch that has none. The cards stay usable while it runs.
  useEffect(() => {
    if (!modelQuestions) return;
    const missing = initial.items.filter(({ question }) => !question).slice(0, 10).map(({ conceptId }) => conceptId);
    if (!missing.length) return;
    void requestReviewQuestions(missing).then(async (reply) => {
      if (reply.status !== 'written' || !reply.written) return;
      const fresh = new Map((await load()).items.map((item) => [item.conceptId, item.question]));
      setQueue((items) => items.map((item) => ({ ...item, question: fresh.get(item.conceptId) ?? item.question })));
    }).catch(() => {});
  }, [initial, modelQuestions]);

  const answer = useCallback((rating: ReviewRating) => {
    if (!current || !revealed || busy.current) return;
    busy.current = true;
    setError(false);
    void grade(current.conceptId, rating).then((result) => {
      if ('refused' in result) { setQueue((items) => items.slice(1)); return; }
      const soon = result.state.due - Date.now() <= SAME_SITTING_MS;
      setQueue(([first, ...rest]) => first && soon ? [...rest, { ...first, isNew: false, state: result.state }] : rest);
      setGraded((count) => count + 1);
      setNextDue((earliest) => earliest === undefined ? result.state.due : Math.min(earliest, result.state.due));
    }).catch(() => setError(true)).finally(() => { busy.current = false; setRevealed(false); });
  }, [current, revealed]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || (target instanceof HTMLElement &&
        target.closest('input, textarea, select, button, a, [role="dialog"], [role="menu"], [contenteditable="true"]'))) return;
      if (event.key === ' ' && current && !revealed) { event.preventDefault(); setRevealed(true); return; }
      const rating = REVIEW_RATINGS[Number(event.key) - 1];
      if (rating && revealed) answer(rating);
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [answer, current, revealed]);

  if (!current) {
    return (
      <EmptyState title={graded ? 'All done for now' : 'Nothing is due'}
        description={nextDue ? `Your next review is ${dateTime.format(nextDue)}.`
          : 'Concepts you learn, or star on the Atlas, show up here to be reviewed.'}
        actions={<Button href="/atlas.html" variant="secondary" size="sm" label="Open the Atlas" />} />
    );
  }
  const due = queue.filter(({ isNew }) => !isNew).length;
  const fresh = queue.length - due;
  return (
    <VStack gap={4}>
      <Text as="p" type="supporting">{due} due · {fresh} new</Text>
      <Card padding={5}>
        <VStack gap={4} aria-label="Review card" role="group">
          <VStack gap={1}>
            <Text type="supporting">{current.question ? 'Question' : 'Concept'}</Text>
            <Heading level={2} className="wrap-anywhere">{current.question ?? current.name}</Heading>
          </VStack>
          {revealed ? (
            <VStack gap={3}>
              {current.question && <Text weight="bold" className="wrap-anywhere">{current.name}</Text>}
              <Text className="wrap-anywhere">{current.gloss || 'No gloss yet.'}</Text>
              <Evidence item={current} />
            </VStack>
          ) : (
            <Button variant="primary" size="sm" label="Show answer" aria-keyshortcuts="Space" onClick={() => setRevealed(true)} />
          )}
        </VStack>
      </Card>
      {revealed && (
        <ButtonGroup label="How well did you remember it?" size="sm">
          {REVIEW_RATINGS.map((rating, index) => (
            <Button key={rating} variant="secondary" size="sm" label={ratingLabels[rating]} aria-keyshortcuts={String(index + 1)}
              onClick={() => answer(rating)} />
          ))}
        </ButtonGroup>
      )}
      {error && <Text role="alert">Could not save that answer. Try again.</Text>}
    </VStack>
  );
}

export function App() {
  const settings = useReviewSettings();
  const [queue, setQueue] = useState<ReviewQueue | 'error'>();
  const on = settings ? reviewEnabled(settings) : undefined;
  useEffect(() => {
    if (!on) return;
    let live = true;
    void load().then((value) => live && setQueue(value)).catch(() => live && setQueue('error'));
    return () => { live = false; };
  }, [on]);

  return (
    <TrailmapShell title="Review" section="review" description="Revisit the concepts you learned, scheduled by spaced repetition.">
      {settings === undefined ? <Text type="supporting">Loading…</Text> : !on ? (
        <EmptyState title="Review is off"
          description="Turn it on in Settings to review the concepts you have learned. Nothing is scheduled while it is off."
          actions={<Button href="/settings.html#review" variant="primary" size="sm" label="Open review settings" />} />
      ) : queue === undefined ? <Text type="supporting">Looking for cards…</Text>
        : queue === 'error' ? <Text role="alert">Could not read your cards.</Text>
        : <ReviewSession initial={queue} modelQuestions={modelQuestionsEnabled(settings)} />}
    </TrailmapShell>
  );
}
