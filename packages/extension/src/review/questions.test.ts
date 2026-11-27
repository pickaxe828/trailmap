import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import type { ConceptEvidence } from '../concepts/evidence';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import type { ModelRoute } from '../llm/settings';
import type { RecordingSettings } from '../privacy/policy';
import type { ModelRequester } from '../wrapup/handlers';
import { readReviewQueue, starConcept } from './deck';
import { QUESTION_BATCH, writeReviewQuestions, type QuestionDeps } from './questions';
import type { ReviewSettings } from './settings';

let db: TrailmapDb;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); });
afterEach(() => db.delete());

const NOW = Date.UTC(2026, 5, 1);
const recording: RecordingSettings = { paused: false, skippedHosts: [] };
const route: ModelRoute = { provider: 'ollama', model: 'fixture' };
type Input = { concepts: { ref: string; name: string; gloss: string; snippet?: string }[] };
type Call = { input: Input; guard: Parameters<ModelRequester>[2]; task: string };

function fakeModel(reply: (input: Input) => unknown = ({ concepts }) => ({ questions: concepts.map(({ ref, name }) => ({ ref, question: `What is ${name}?` })) })) {
  const calls: Call[] = [];
  const request: ModelRequester = async (_db, payload, guard) => {
    if (!await guard.allow()) throw new Error('refused');
    const input = JSON.parse(payload.input) as Input;
    calls.push({ input, guard, task: payload.task });
    return { output: reply(input) };
  };
  return { calls, request };
}
const deps = (request: ModelRequester, settings: ReviewSettings, recordingSettings = recording): QuestionDeps => ({
  db, getSettings: () => recordingSettings, readReviewSettings: async () => settings, request, readRoute: async () => route, now: () => NOW,
});
const on: ReviewSettings = { enabled: true, modelQuestions: true };

const expedition: Expedition = { id: 'e1', title: 'Phonetics', drivingQuestion: null, kind: 'learning', startedAt: 1, endedAt: 9, fieldNotes: null, userEdited: false, threadId: null };
const visit = (id: string, host = 'learn.test', extra: Partial<Visit> = {}): Visit => ({ id, url: `https://${host}/${id}`, canonicalUrl: `https://${host}/${id}`, title: id,
  tabId: 1, parentVisitId: null, transition: 'link', startedAt: 2, activeMs: 70_000, scrollDepth: 1, engagement: 'read', expeditionId: 'e1', ...extra });
const evidence = (id: string, conceptId: string, visitId: string, host = 'learn.test'): ConceptEvidence => ({ id, conceptId, visitId, canonicalUrl: `https://${host}/${visitId}`,
  name: conceptId, gloss: '', kind: 'concept', role: 'explains', salience: 'central', startedAt: 2, embedding: null });

async function seed(host = 'learn.test', count = 1) {
  await db.expeditions.put(expedition);
  const ids = Array.from({ length: count }, (_, i) => `taa${i}`);
  await db.visits.put(visit('a', host));
  await db.pages.put({ canonicalUrl: `https://${host}/a`, sourceVisitId: 'a', sourceUrl: `https://${host}/a`, text: ids.map((id) => `${id} is a click consonant.`).join(' '), textHash: 'h', summary: null, takeaways: [],
    embedding: null, pageKind: 'article', enrichedAt: 1 });
  await db.concepts.bulkPut(ids.map((id, i) => ({ id, name: id, aliases: [], kind: 'concept' as const, gloss: `${id} gloss`, embedding: null, exposure: 1, firstSeen: i })));
  await db.conceptEvidence.bulkPut(ids.map((id) => evidence(`ev-${id}`, id, 'a', host)));
  for (const id of ids) await starConcept(db, id, NOW);
  return ids;
}

test('with the model-question sub-setting off nothing is read and nothing is sent', async () => {
  const ids = await seed();
  const model = fakeModel();
  for (const settings of [{}, { enabled: true }, { enabled: true, modelQuestions: false }, { modelQuestions: true }] as ReviewSettings[]) {
    expect(await writeReviewQuestions(deps(model.request, settings), ids)).toEqual({ status: 'off' });
  }
  expect(model.calls).toEqual([]);
  expect(await db.sentToModel.count()).toBe(0);
  expect(await db.reviewCards.count()).toBe(0);
});

test('with it on, one call carries names, glosses and snippets, the question is stored on the card and shown', async () => {
  const [id] = await seed();
  const model = fakeModel();
  expect(await writeReviewQuestions(deps(model.request, on), [id!])).toEqual({ status: 'written', written: 1 });
  expect(model.calls).toHaveLength(1);
  expect(model.calls[0]).toMatchObject({ task: 'review_questions', input: { concepts: [{ ref: 'c1', name: 'taa0', gloss: 'taa0 gloss', snippet: 'taa0 is a click consonant.' }] },
    guard: { visitIds: ['a'], canonicalUrls: ['https://learn.test/a'], expeditionIds: ['e1'] } });
  expect((await readReviewQueue(db, NOW)).items[0]).toMatchObject({ conceptId: 'taa0', question: 'What is taa0?', isNew: true });
});

test('a changed gloss never shows the old question', async () => {
  const [id] = await seed();
  await writeReviewQuestions(deps(fakeModel().request, on), [id!]);
  await db.concepts.update('taa0', { gloss: 'a new gloss' });
  expect((await readReviewQueue(db, NOW)).items[0]!.question).toBeUndefined();
});

test('a concept that already has a current question is not sent again', async () => {
  const [id] = await seed();
  await writeReviewQuestions(deps(fakeModel().request, on), [id!]);
  const again = fakeModel();
  expect(await writeReviewQuestions(deps(again.request, on), [id!])).toEqual({ status: 'nothing' });
  expect(again.calls).toEqual([]);
});

test('nothing is sent when the concept\'s evidence is from a skipped site, a private page or while recording is paused', async () => {
  const [id] = await seed();
  const cases: [RecordingSettings, () => Promise<unknown>][] = [[{ ...recording, skippedHosts: ['learn.test'] }, async () => {}], [{ ...recording, paused: true }, async () => {}],
    [recording, () => db.visits.update('a', { privacyBlocked: true })]];
  for (const [settings, change] of cases) {
    await change();
    const model = fakeModel();
    expect(await writeReviewQuestions(deps(model.request, on, settings), [id!])).toEqual({ status: 'nothing' });
    expect(model.calls).toEqual([]);
  }
  expect(await db.sentToModel.count()).toBe(0);
});

test('one blocked evidence row hides a concept whose gloss was written from it, even if another row is fine', async () => {
  const [id] = await seed();
  await db.visits.put(visit('b', 'secret.test'));
  await db.pages.put({ canonicalUrl: 'https://secret.test/b', sourceVisitId: 'b', sourceUrl: 'https://secret.test/b', text: 'x', textHash: 'h', summary: null, takeaways: [], embedding: null, pageKind: null, enrichedAt: 1 });
  await db.conceptEvidence.put(evidence('ev-b', id!, 'b', 'secret.test'));
  const model = fakeModel();
  expect(await writeReviewQuestions(deps(model.request, on, { ...recording, skippedHosts: ['secret.test'] }), [id!])).toEqual({ status: 'nothing' });
  expect(model.calls).toEqual([]);
});

test('turning the sub-setting off while the request is in flight stops the send', async () => {
  const [id] = await seed();
  let current: ReviewSettings = on;
  const model = fakeModel();
  const result = await writeReviewQuestions({ ...deps(model.request, on), readReviewSettings: async () => { const now = current; current = { enabled: true }; return now; } }, [id!]);
  expect(result).toMatchObject({ status: 'error' });
  expect(model.calls).toEqual([]);
});

test('questions for refs that were not sent, empty questions and invalid output are dropped', async () => {
  const [id] = await seed();
  const bad = fakeModel(() => ({ questions: [{ ref: 'c9', question: 'Who?' }, { ref: 'c1', question: '   ' }] }));
  expect(await writeReviewQuestions(deps(bad.request, on), [id!])).toEqual({ status: 'written', written: 0 });
  expect(await db.reviewCards.count()).toBe(0);
  const garbage = fakeModel(() => ({ nope: 1 }));
  expect(await writeReviewQuestions(deps(garbage.request, on), [id!])).toEqual({ status: 'error', code: 'invalid_output' });
});

test('a concept dismissed while the model worked gets no stored question', async () => {
  const [id] = await seed();
  const model = fakeModel((input) => { void db.dismissedConcepts.put({ conceptId: id!, at: 1, evidenceKeys: [] }); return { questions: input.concepts.map(({ ref }) => ({ ref, question: 'Q?' })) }; });
  await writeReviewQuestions(deps(model.request, on), [id!]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await db.reviewCards.count()).toBe(0);
});

test('a batch is capped, in one call', async () => {
  const ids = await seed('learn.test', QUESTION_BATCH + 4);
  const model = fakeModel();
  const result = await writeReviewQuestions(deps(model.request, on), ids);
  expect(result).toEqual({ status: 'written', written: QUESTION_BATCH });
  expect(model.calls).toHaveLength(1);
});
