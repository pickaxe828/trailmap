import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Concept, Expedition, Visit } from '@trailmap/shared';
import { dismissConcept, readDismissedConcepts, restoreConcept } from '../concepts/dismiss';
import type { ConceptEvidence } from '../concepts/evidence';
import { readVisibleConcepts } from '../concepts/read';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { readAtlas } from './data';

let db: TrailmapDb;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); });
afterEach(() => db.delete());

const expedition: Expedition = { id: 'e1', title: 'Phonetics', drivingQuestion: null, kind: 'learning', startedAt: 1, endedAt: 9,
  fieldNotes: null, userEdited: false, threadId: null };
const visit = (id: string, extra: Partial<Visit> = {}): Visit => ({ id, url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`,
  title: id, tabId: 1, parentVisitId: null, transition: 'link', startedAt: 2, activeMs: 60_000, scrollDepth: 0.8, engagement: 'read',
  expeditionId: 'e1', ...extra });
const concept = (id: string, name: string): Concept => ({ id, name, aliases: [], kind: 'concept', gloss: name, embedding: null, exposure: 0, firstSeen: 2 });
const evidence = (id: string, conceptId: string, visitId: string, extra: Partial<ConceptEvidence> = {}): ConceptEvidence => ({
  id, conceptId, visitId, canonicalUrl: `https://learn.test/${visitId}`, name: conceptId, gloss: '', kind: 'concept', role: 'explains',
  salience: 'central', startedAt: 2, embedding: null, ...extra });

async function seed(rows: ConceptEvidence[], visits: Visit[], concepts = ['taa', 'pharyngealization']) {
  await db.expeditions.put(expedition);
  await db.visits.bulkPut(visits);
  await db.pages.bulkPut(visits.map(({ canonicalUrl }) => ({ canonicalUrl, text: '', textHash: 'h', summary: null, takeaways: [], embedding: null, pageKind: 'article', enrichedAt: null })));
  await db.concepts.bulkPut(concepts.map((id) => concept(id, id)));
  await db.conceptEvidence.bulkPut(rows);
}
const names = (list: { id: string }[]) => list.map(({ id }) => id).sort();

test('two skimmed pages that only mention a concept as an example leave it off the Atlas, and the Seen list holds it', async () => {
  await seed([evidence('1', 'taa', 'a', { role: 'mentions', salience: 'passing' }), evidence('2', 'taa', 'b', { role: 'mentions', salience: 'passing' }),
    evidence('3', 'pharyngealization', 'a')], [visit('a', { engagement: 'skimmed', activeMs: 20_000 }), visit('b', { engagement: 'skimmed' })]);
  const atlas = await readAtlas(db);
  expect(names(atlas.concepts)).toEqual([]);
  expect(names(atlas.seen)).toEqual(['pharyngealization', 'taa']);
  expect(names(await readVisibleConcepts(db))).toEqual([]);
});

test('a concept that is central on a page read properly is on the Atlas, studied, with exposure from studied pages only', async () => {
  await seed([evidence('1', 'pharyngealization', 'a'), evidence('2', 'pharyngealization', 'b', { salience: 'passing', role: 'mentions' }),
    evidence('3', 'taa', 'a', { role: 'mentions', salience: 'passing' })], [visit('a'), visit('b')]);
  const atlas = await readAtlas(db);
  expect(atlas.concepts).toMatchObject([{ id: 'pharyngealization', strength: 'studied', exposure: 1 }]);
  expect(names(atlas.seen)).toEqual(['taa']);
  expect(names(await readVisibleConcepts(db))).toEqual(['pharyngealization']);
});

test('a concept written in My notes is on the Atlas as learned, with no page behind it', async () => {
  await seed([evidence('1', 'taa', 'e1', { role: 'learned', canonicalUrl: '', expeditionId: 'e1' })], []);
  expect((await readAtlas(db)).concepts).toMatchObject([{ id: 'taa', strength: 'learned' }]);
});

test('a highlight that names a concept makes it learned even on a skimmed page', async () => {
  await seed([evidence('1', 'taa', 'a', { salience: 'passing', role: 'mentions', name: 'Taa' })], [visit('a', { engagement: 'skimmed' })]);
  await db.highlights.add({ id: 'h', visitId: 'a', text: 'Taa has a huge consonant inventory', at: 3, source: 'selection' });
  expect((await readAtlas(db)).concepts).toMatchObject([{ id: 'taa', strength: 'learned' }]);
});

test('"I didn\'t learn this" hides the concept and search; Undo restores it; later passing mentions do not bring it back', async () => {
  await seed([evidence('1', 'taa', 'a')], [visit('a'), visit('b')]);
  expect(names((await readAtlas(db)).concepts)).toEqual(['taa']);
  await dismissConcept(db, 'taa', 100);
  let atlas = await readAtlas(db);
  expect(names(atlas.concepts)).toEqual([]);
  expect(names(atlas.seen)).toEqual([]);
  expect(atlas.dismissed).toMatchObject([{ id: 'taa' }]);
  expect(await readDismissedConcepts(db)).toMatchObject([{ id: 'taa', name: 'taa' }]);
  expect(names(await readVisibleConcepts(db))).toEqual([]);
  expect(await db.conceptEvidence.count()).toBe(1); // evidence is kept

  await db.conceptEvidence.add(evidence('2', 'taa', 'b', { role: 'mentions', salience: 'passing' }));
  await db.conceptEvidence.add(evidence('3', 'taa', 'b', { salience: 'central' })); // a newly read page stays Seen
  expect(names((await readAtlas(db)).concepts)).toEqual([]);

  await restoreConcept(db, 'taa');
  atlas = await readAtlas(db);
  expect(names(atlas.concepts)).toEqual(['taa']);
  expect(atlas.dismissed).toEqual([]);
});

test('after a dismissal, new notes that teach the concept bring it back', async () => {
  await seed([evidence('1', 'taa', 'e1', { role: 'learned', canonicalUrl: '', expeditionId: 'e1' })], []);
  await dismissConcept(db, 'taa', 100);
  expect(names((await readAtlas(db)).concepts)).toEqual([]);
  // The same notes asked about again replace the row but not the dismissal.
  await db.conceptEvidence.clear();
  await db.conceptEvidence.add(evidence('2', 'taa', 'e1', { role: 'learned', canonicalUrl: '', expeditionId: 'e1' }));
  expect(names((await readAtlas(db)).concepts)).toEqual([]);
  await db.expeditions.put({ ...expedition, id: 'e2' });
  await db.conceptEvidence.add(evidence('3', 'taa', 'e2', { role: 'learned', canonicalUrl: '', expeditionId: 'e2' }));
  expect(names((await readAtlas(db)).concepts)).toEqual(['taa']);
});

test('errand Expeditions never put a concept on the Atlas', async () => {
  await seed([evidence('1', 'taa', 'a')], [visit('a')]);
  await db.expeditions.put({ ...expedition, kind: 'errand' });
  expect((await readAtlas(db)).concepts).toEqual([]);
});
