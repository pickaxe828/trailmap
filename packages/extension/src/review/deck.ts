import type { Concept } from '@trailmap/shared';
import { readAtlas } from '../atlas/data';
import type { TrailmapDb } from '../db/db';
import { DAY_MS, gradeCard, newReviewState, type ReviewRating, type ReviewState } from './scheduler';
import { readEvidenceSnippet, type Snippet } from './snippet';
import type { ConceptStar } from './types';

/** New cards introduced in any 24 hours, so turning review on never dumps a whole Atlas into one sitting. */
export const NEW_CARDS_PER_DAY = 10;
/** One sitting's queue is at most this many cards. */
export const QUEUE_LIMIT = 50;

export type ReviewItem = {
  conceptId: string;
  name: string;
  kind: Concept['kind'];
  gloss: string;
  /** The model-written question, only while it was written for the current gloss. */
  question?: string;
  /** One piece of still-visible evidence. Absent when none is left. */
  snippet?: Snippet;
  starred: boolean;
  isNew: boolean;
  state: ReviewState;
};

export type ReviewQueue = {
  items: ReviewItem[];
  /** Cards whose scheduled time has come (not counting new ones). */
  dueCount: number;
  /** New cards in the queue after the daily limit. */
  newCount: number;
  /** When the next scheduled card is due, if any (shown on the empty state). */
  nextDue?: number;
};

export const reviewTables = (db: TrailmapDb) => [db.concepts, db.conceptEvidence, db.visits, db.highlights, db.dismissedConcepts, db.edges,
  db.expeditions, db.threads, db.reviewCards, db.reviewLogs, db.conceptStars, db.pages, db.notes];

/**
 * What can be reviewed: every Concept the user learned (PLAN §4.5) plus the ones they starred. `readAtlas` already leaves out
 * "I didn't learn this" Concepts and errand-only evidence, so a dismissed Concept never gets a card, starred or not.
 * Call inside a read transaction over {@link reviewTables}.
 */
export async function readEligibleConcepts(db: TrailmapDb): Promise<{ concept: Concept; starred: boolean }[]> {
  const [atlas, stars] = await Promise.all([readAtlas(db), db.conceptStars.toArray()]);
  const starred = new Set(stars.map(({ conceptId }) => conceptId));
  const shown = [...atlas.concepts, ...atlas.seen];
  return shown.filter((concept) => starred.has(concept.id) || ('strength' in concept && concept.strength === 'learned'))
    .map((concept) => ({ concept, starred: starred.has(concept.id) }));
}

/** Due cards (oldest first), then new ones up to the daily limit. A card with nothing to show (no gloss, no evidence) is skipped. */
export function readReviewQueue(db: TrailmapDb, now: number): Promise<ReviewQueue> {
  return db.transaction('r', reviewTables(db), async () => {
    const eligible = await readEligibleConcepts(db);
    const cards = new Map((await db.reviewCards.bulkGet(eligible.map(({ concept }) => concept.id))).flatMap((card) => card ? [[card.conceptId, card] as const] : []));
    const introduced = await db.reviewLogs.where('at').above(now - DAY_MS).filter(({ stateBefore }) => stateBefore === 'new').count();
    const room = Math.max(0, NEW_CARDS_PER_DAY - introduced);

    const scheduled = eligible.filter(({ concept }) => cards.get(concept.id)?.state !== undefined && cards.get(concept.id)!.state !== 'new');
    const due = scheduled.filter(({ concept }) => cards.get(concept.id)!.due <= now)
      .sort((a, b) => cards.get(a.concept.id)!.due - cards.get(b.concept.id)!.due || a.concept.id.localeCompare(b.concept.id));
    const fresh = eligible.filter(({ concept }) => !scheduled.some((other) => other.concept.id === concept.id))
      .sort((a, b) => a.concept.firstSeen - b.concept.firstSeen || a.concept.id.localeCompare(b.concept.id)).slice(0, room);
    const upcoming = scheduled.map(({ concept }) => cards.get(concept.id)!.due).filter((due) => due > now).sort((a, b) => a - b);

    const items: ReviewItem[] = [];
    for (const { concept, starred } of [...due, ...fresh].slice(0, QUEUE_LIMIT)) {
      const card = cards.get(concept.id);
      const snippet = await readEvidenceSnippet(db, concept.id);
      if (!concept.gloss.trim() && !snippet) continue;
      items.push({
        conceptId: concept.id, name: concept.name, kind: concept.kind, gloss: concept.gloss, snippet, starred,
        question: card?.question && card.question.forGloss === concept.gloss ? card.question.text : undefined,
        isNew: !card || card.state === 'new', state: card ?? newReviewState(now),
      });
    }
    return { items, dueCount: due.length, newCount: fresh.length, nextDue: upcoming[0] };
  });
}

export type GradeResult = { state: ReviewState } | { refused: 'gone' | 'dismissed' };

/** Records one grade. A Concept that was forgotten, merged away or dismissed since the card was shown is refused, not revived. */
export function gradeConcept(db: TrailmapDb, conceptId: string, rating: ReviewRating, now: number, newId: () => string): Promise<GradeResult> {
  return db.transaction('rw', [db.concepts, db.dismissedConcepts, db.reviewCards, db.reviewLogs], async () => {
    if (!await db.concepts.get(conceptId)) return { refused: 'gone' as const };
    if (await db.dismissedConcepts.get(conceptId)) return { refused: 'dismissed' as const };
    const card = await db.reviewCards.get(conceptId);
    const { state, log } = gradeCard(card ?? newReviewState(now), rating, now);
    await db.reviewCards.put({ ...card, ...state, conceptId });
    await db.reviewLogs.add({ ...log, id: newId(), conceptId });
    return { state };
  });
}

export const starConcept = (db: TrailmapDb, conceptId: string, at: number) => db.conceptStars.put({ conceptId, at });
export const unstarConcept = (db: TrailmapDb, conceptId: string) => db.conceptStars.delete(conceptId);
export const readStarred = async (db: TrailmapDb): Promise<Set<string>> => new Set(await db.conceptStars.toCollection().primaryKeys() as string[]);

/**
 * Review state for a Concept that no longer exists (merged away, or its evidence is gone) is derived data with nothing left to
 * stand on. Forget removes it at once; this catches the rest when the Review page opens.
 */
export function pruneReview(db: TrailmapDb) {
  return db.transaction('rw', [db.concepts, db.reviewCards, db.reviewLogs, db.conceptStars], async () => {
    const known = new Set(await db.concepts.toCollection().primaryKeys() as string[]);
    const orphan = (id: string) => !known.has(id);
    await db.reviewCards.filter((card) => orphan(card.conceptId)).delete();
    await db.reviewLogs.filter((log) => orphan(log.conceptId)).delete();
    await db.conceptStars.filter((star: ConceptStar) => orphan(star.conceptId)).delete();
  });
}
