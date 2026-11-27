import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Concept, Expedition, Visit } from '@trailmap/shared';
import { dismissConcept, restoreConcept } from '../concepts/dismiss';
import type { ConceptEvidence } from '../concepts/evidence';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { gradeConcept, NEW_CARDS_PER_DAY, pruneReview, readReviewQueue, starConcept, unstarConcept } from './deck';
import { DAY_MS } from './scheduler';
import { modelQuestionsEnabled, reviewEnabled } from './settings';
import { extractSnippet, readEvidenceSnippet } from './snippet';

let db: TrailmapDb;
let ids: number;
const NOW = Date.UTC(2026, 5, 1);
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); ids = 0; });
afterEach(() => db.delete());
const newId = () => `log-${++ids}`;

const expedition = (id: string, extra: Partial<Expedition> = {}): Expedition => ({ id, title: `Expedition ${id}`, drivingQuestion: null, kind: 'learning',
  startedAt: 1, endedAt: 9, fieldNotes: null, userEdited: false, threadId: null, ...extra });
const visit = (id: string, extra: Partial<Visit> = {}): Visit => ({ id, url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`,
  title: `Title ${id}`, tabId: 1, parentVisitId: null, transition: 'link', startedAt: 2, activeMs: 60_000, scrollDepth: 0.8, engagement: 'read',
  expeditionId: 'e1', ...extra });
const concept = (id: string, extra: Partial<Concept> = {}): Concept => ({ id, name: id, aliases: [], kind: 'concept', gloss: `${id} is a thing.`,
  embedding: null, exposure: 0, firstSeen: 2, ...extra });
const evidence = (id: string, conceptId: string, visitId: string, extra: Partial<ConceptEvidence> = {}): ConceptEvidence => ({
  id, conceptId, visitId, canonicalUrl: `https://learn.test/${visitId}`, name: conceptId, gloss: '', kind: 'concept', role: 'explains',
  salience: 'central', startedAt: 2, embedding: null, ...extra });

/** Learned = written in My notes of e1; studied = central on a page read properly; seen = passing mention. */
async function seed() {
  await db.expeditions.put(expedition('e1', { myNotes: 'Today I learned that Alpha means the first thing. Beta too.' }));
  await db.visits.bulkPut([visit('a'), visit('b', { engagement: 'skimmed' })]);
  await db.pages.bulkPut([{ canonicalUrl: 'https://learn.test/a', text: 'Gamma is the third letter. It follows beta.', textHash: 'h', summary: 'About letters.',
    takeaways: [], embedding: null, pageKind: 'article', enrichedAt: 1 },
  { canonicalUrl: 'https://learn.test/b', text: 'Delta shows up here.', textHash: 'h', summary: null, takeaways: [], embedding: null, pageKind: 'article', enrichedAt: 1 }]);
  await db.concepts.bulkPut([concept('alpha', { name: 'Alpha', firstSeen: 1 }), concept('gamma', { name: 'Gamma', firstSeen: 2 }), concept('delta', { name: 'Delta', firstSeen: 3 })]);
  await db.conceptEvidence.bulkPut([
    evidence('1', 'alpha', 'e1', { role: 'learned', canonicalUrl: '', expeditionId: 'e1', name: 'Alpha' }),
    evidence('2', 'gamma', 'a', { name: 'Gamma' }),
    evidence('3', 'delta', 'b', { role: 'mentions', salience: 'passing', name: 'Delta' }),
  ]);
}
const queue = async (now = NOW) => (await readReviewQueue(db, now)).items.map(({ conceptId }) => conceptId);

test('settings: review and its model sub-setting are off unless the user turned them on', () => {
  expect(reviewEnabled({})).toBe(false);
  expect(modelQuestionsEnabled({ modelQuestions: true })).toBe(false); // the sub-setting alone does nothing
  expect(modelQuestionsEnabled({ enabled: true })).toBe(false);
  expect(modelQuestionsEnabled({ enabled: true, modelQuestions: true })).toBe(true);
});

test('only learned concepts are due: a studied concept and a glimpsed one are not', async () => {
  await seed();
  expect(await queue()).toEqual(['alpha']);
});

test('a starred concept is reviewed even when it was only glimpsed, and unstarring removes it', async () => {
  await seed();
  await starConcept(db, 'delta', NOW);
  expect(await queue()).toEqual(['alpha', 'delta']);
  await unstarConcept(db, 'delta');
  expect(await queue()).toEqual(['alpha']);
});

test('"I didn\'t learn this" removes the concept from the queue, starred or not, and Undo brings it back', async () => {
  await seed();
  await starConcept(db, 'alpha', NOW);
  await starConcept(db, 'delta', NOW);
  await dismissConcept(db, 'alpha', NOW);
  await dismissConcept(db, 'delta', NOW);
  expect(await queue()).toEqual([]);
  await restoreConcept(db, 'alpha');
  expect(await queue()).toEqual(['alpha']);
});

test('a concept that only appears in an errand is never reviewed, even if starred', async () => {
  await seed();
  await db.expeditions.put(expedition('e1', { kind: 'errand', myNotes: 'Alpha' }));
  await starConcept(db, 'gamma', NOW);
  expect(await queue()).toEqual([]);
});

test('a card shows the concept name, its gloss and one evidence snippet from the user\'s own notes first', async () => {
  await seed();
  const [item] = (await readReviewQueue(db, NOW)).items;
  expect(item).toMatchObject({ name: 'Alpha', gloss: 'alpha is a thing.', isNew: true, starred: false });
  expect(item!.snippet).toMatchObject({ text: 'Today I learned that Alpha means the first thing.', source: { kind: 'my-notes', title: 'Expedition e1' } });
});

test('grading schedules the card from the algorithm and removes it from the queue until it is due again', async () => {
  await seed();
  const graded = await gradeConcept(db, 'alpha', 'good', NOW, newId);
  expect(graded).toMatchObject({ state: { state: 'review', due: NOW + 2 * DAY_MS, reps: 1 } });
  expect(await db.reviewCards.get('alpha')).toMatchObject({ conceptId: 'alpha', due: NOW + 2 * DAY_MS });
  expect(await db.reviewLogs.toArray()).toMatchObject([{ conceptId: 'alpha', rating: 'good', at: NOW, stateBefore: 'new' }]);
  expect(await queue(NOW + DAY_MS)).toEqual([]);
  const later = await readReviewQueue(db, NOW + 2 * DAY_MS);
  expect(later.items.map(({ conceptId, isNew }) => [conceptId, isNew])).toEqual([['alpha', false]]);
  expect(later.dueCount).toBe(1);
});

test('the queue reports when the next card is due, for the empty state', async () => {
  await seed();
  await gradeConcept(db, 'alpha', 'easy', NOW, newId);
  expect(await readReviewQueue(db, NOW + 1)).toMatchObject({ items: [], dueCount: 0, nextDue: NOW + 8 * DAY_MS });
});

test('cards due come before new ones, oldest due first', async () => {
  await seed();
  await starConcept(db, 'delta', NOW);
  await starConcept(db, 'gamma', NOW);
  await gradeConcept(db, 'delta', 'good', NOW, newId);
  await gradeConcept(db, 'alpha', 'good', NOW - 5 * DAY_MS, newId);
  expect(await queue(NOW + 10 * DAY_MS)).toEqual(['alpha', 'delta', 'gamma']);
});

test('no more than the daily number of new cards are offered, and grading one uses up its place for 24 hours', async () => {
  await db.expeditions.put(expedition('e1', { myNotes: 'x' }));
  const names = Array.from({ length: NEW_CARDS_PER_DAY + 5 }, (_, i) => `c${String(i).padStart(2, '0')}`);
  await db.concepts.bulkPut(names.map((id, i) => concept(id, { firstSeen: i })));
  await db.conceptEvidence.bulkPut(names.map((id) => evidence(`ev-${id}`, id, 'e1', { role: 'learned', canonicalUrl: '', expeditionId: 'e1' })));
  expect(await queue()).toHaveLength(NEW_CARDS_PER_DAY);
  await gradeConcept(db, 'c00', 'again', NOW, newId);
  expect(await queue(NOW + 1)).not.toContain('c00'); // due in ten minutes
  expect(await queue(NOW + 60_000)).toHaveLength(NEW_CARDS_PER_DAY - 1);
  expect(await queue(NOW + DAY_MS + 60_000)).toHaveLength(NEW_CARDS_PER_DAY + 1); // c00 is due again; the window moved on
});

test('grading a concept that was dismissed or forgotten meanwhile is refused and writes nothing', async () => {
  await seed();
  await dismissConcept(db, 'alpha', NOW);
  expect(await gradeConcept(db, 'alpha', 'good', NOW, newId)).toEqual({ refused: 'dismissed' });
  expect(await gradeConcept(db, 'missing', 'good', NOW, newId)).toEqual({ refused: 'gone' });
  expect(await db.reviewCards.count() + await db.reviewLogs.count()).toBe(0);
});

test('a concept with neither gloss nor evidence snippet has nothing to show and is skipped', async () => {
  await seed();
  await db.concepts.update('alpha', { gloss: '  ' });
  await db.expeditions.update('e1', { myNotes: 'nothing relevant' });
  expect(await queue()).toEqual([]);
});

test('pruning removes review state for concepts that no longer exist, and leaves the rest', async () => {
  await seed();
  await gradeConcept(db, 'alpha', 'good', NOW, newId);
  await db.reviewCards.put({ conceptId: 'ghost', due: 1, stability: 1, difficulty: 1, scheduledDays: 1, reps: 1, lapses: 0, learningSteps: 0, state: 'review',
    question: { text: 'ghost question', forGloss: '', at: 1 } });
  await db.reviewLogs.add({ id: 'ghost-log', conceptId: 'ghost', rating: 'good', at: 1, stateBefore: 'new', due: 1, stability: 1, difficulty: 1 });
  await starConcept(db, 'ghost', 1);
  await pruneReview(db);
  expect((await db.reviewCards.toArray()).map(({ conceptId }) => conceptId)).toEqual(['alpha']);
  expect((await db.reviewLogs.toArray()).map(({ conceptId }) => conceptId)).toEqual(['alpha']);
  expect(await db.conceptStars.count()).toBe(0);
});

test('snippets: a highlight beats page text; page text beats the summary; forgotten, private and errand sources give nothing', async () => {
  await seed();
  await db.highlights.add({ id: 'h', visitId: 'a', canonicalUrl: 'https://learn.test/a', text: 'Gamma, as I highlighted it.', at: 3, source: 'selection' });
  expect(await readEvidenceSnippet(db, 'gamma')).toMatchObject({ text: 'Gamma, as I highlighted it.', source: { kind: 'highlight', title: 'Title a' } });
  await db.highlights.clear();
  expect((await readEvidenceSnippet(db, 'gamma'))?.text).toBe('Gamma is the third letter.');
  await db.pages.update('https://learn.test/a', { text: 'nothing here' });
  expect((await readEvidenceSnippet(db, 'gamma'))?.text).toBe('About letters.');
  await db.visits.update('a', { privacyBlocked: true });
  expect(await readEvidenceSnippet(db, 'gamma')).toBeUndefined();
  await db.visits.update('a', { privacyBlocked: undefined });
  await db.pages.delete('https://learn.test/a');
  expect(await readEvidenceSnippet(db, 'gamma')).toBeUndefined();
});

test('snippets from an AI conversation say so', async () => {
  await seed();
  await db.visits.update('a', { aiConversation: true });
  expect((await readEvidenceSnippet(db, 'gamma'))?.source.aiGenerated).toBe(true);
});

test('extractSnippet picks the sentence that names the concept and trims long ones around the name', () => {
  expect(extractSnippet('First one. Taa has clicks! Last.', ['taa'])).toBe('Taa has clicks!');
  expect(extractSnippet('nothing here', ['taa'])).toBeUndefined();
  const long = `${'word '.repeat(80)}Taa is here ${'word '.repeat(80)}`;
  const snippet = extractSnippet(long, ['Taa'], 100)!;
  expect(snippet).toContain('Taa');
  expect(snippet.length).toBeLessThanOrEqual(105);
});
