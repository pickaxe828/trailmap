import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import { createCorrections } from '../corrections/corrections';
import type { ConceptEvidence } from '../concepts/evidence';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { gradeConcept, starConcept } from './deck';

let db: TrailmapDb;
let ids: number;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); ids = 0; });
afterEach(() => db.delete());
const corrections = () => createCorrections({ db, now: () => 5_000, newId: () => `id-${++ids}` });

const SECRET = 'zebra-finance-secret';
const expedition = (id: string): Expedition => ({ id, title: id, drivingQuestion: null, kind: 'learning', startedAt: 1, endedAt: 9, fieldNotes: null,
  userEdited: false, threadId: null });
const visit = (id: string, host: string): Visit => ({ id, url: `https://${host}/${id}`, canonicalUrl: `https://${host}/${id}`, title: id, tabId: 1,
  parentVisitId: null, transition: 'link', startedAt: 2, activeMs: 60_000, scrollDepth: 0.8, engagement: 'read', expeditionId: 'e1' });
const evidence = (id: string, conceptId: string, visitId: string, host: string): ConceptEvidence => ({ id, conceptId, visitId,
  canonicalUrl: `https://${host}/${visitId}`, name: conceptId, gloss: '', kind: 'concept', role: 'explains', salience: 'central', startedAt: 2, embedding: null });
const everything = async () => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));

/** `solo` rests on one secret page; `shared` on the secret page and a page that stays; `plain` on a page that stays. */
async function seed() {
  await db.expeditions.put(expedition('e1'));
  await db.visits.bulkPut([visit('s', 'secret.example'), visit('k', 'keep.example'), visit('k2', 'keep.example')]);
  await db.pages.bulkPut(['s', 'k', 'k2'].map((id) => ({ canonicalUrl: `https://${id === 's' ? 'secret' : 'keep'}.example/${id}`, text: id === 's' ? SECRET : 'ok',
    textHash: 'h', summary: null, takeaways: [], embedding: null, pageKind: 'article' as const, enrichedAt: 1, sourceVisitId: id })));
  await db.concepts.bulkPut(['solo', 'shared', 'plain'].map((id) => ({ id, name: id, aliases: [], kind: 'concept' as const, gloss: `${id} gloss`, embedding: null, exposure: 1, firstSeen: 2 })));
  await db.conceptEvidence.bulkPut([evidence('1', 'solo', 's', 'secret.example'), evidence('2', 'shared', 's', 'secret.example'),
    evidence('3', 'shared', 'k', 'keep.example'), evidence('4', 'plain', 'k2', 'keep.example')]);
  for (const id of ['solo', 'shared', 'plain']) {
    await gradeConcept(db, id, 'good', 1_000, () => `log-${id}`);
    await db.reviewCards.update(id, { question: { text: id === 'plain' ? 'What is plain?' : `What is ${SECRET}?`, forGloss: `${id} gloss`, at: 1 } });
    await starConcept(db, id, 1);
  }
}

test('forgetting the only source of a concept removes the concept, its card, its review log and its star', async () => {
  await seed();
  await corrections().forgetPage('https://secret.example/s');
  expect(await db.concepts.get('solo')).toBeUndefined();
  expect(await db.reviewCards.get('solo')).toBeUndefined();
  expect(await db.reviewLogs.where('conceptId').equals('solo').count()).toBe(0);
  expect(await db.conceptStars.get('solo')).toBeUndefined();
});

test('forgetting one of a concept\'s sources removes its card and log (what it was earned from changed) but keeps the star', async () => {
  await seed();
  await corrections().forgetPage('https://secret.example/s');
  expect(await db.concepts.get('shared')).toBeDefined();
  expect(await db.reviewCards.get('shared')).toBeUndefined();
  expect(await db.reviewLogs.where('conceptId').equals('shared').count()).toBe(0);
  expect(await db.conceptStars.get('shared')).toBeDefined();
});

test('review state of concepts whose sources are untouched survives Forget, and no table still holds the forgotten text', async () => {
  await seed();
  await corrections().forgetPage('https://secret.example/s');
  expect(await db.reviewCards.toArray()).toMatchObject([{ conceptId: 'plain', question: { text: 'What is plain?' } }]);
  expect(await db.reviewLogs.count()).toBe(1);
  expect(await everything()).not.toContain(SECRET);
});

test('forgetting a whole site and forgetting an Expedition do the same', async () => {
  await seed();
  await corrections().forgetSite('secret.example');
  expect((await db.reviewCards.toArray()).map(({ conceptId }) => conceptId)).toEqual(['plain']);
  await corrections().forgetExpedition('e1');
  expect(await db.reviewCards.count() + await db.reviewLogs.count() + await db.conceptStars.count()).toBe(0);
});
