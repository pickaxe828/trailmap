import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Page, Visit } from '@trailmap/shared';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { forgetCascade } from '../corrections/forget';
import type { Embedder } from '../embeddings/embedder';
import { JobQueue } from '../jobs/queue';
import { enqueueConceptResolution } from './enqueue';
import { resolveConcepts } from './resolve';
import { decideConceptMerges } from './verdicts';
import { readConceptEvidence, readExpeditionTopConcepts, readVisibleConceptGraph, readVisibleConcepts } from './read';
import { renderConceptNote } from './note';

let db: TrailmapDb;
let now: number;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); now = 1_000; vectors = { ...defaultVectors }; });
afterEach(() => db.delete());

const mention = (name: string, role: 'explains' | 'mentions' | 'uses' = 'mentions', gloss = name) =>
  ({ name, role, gloss, kind: 'concept' as const });
let vectors: Record<string, number[]>;
const defaultVectors = {
  'Deferred deletion\nDeferred deletion': [0.96, 0.28],
  'Deferred deletion\nAlternative gloss': [0, 1],
  'Gossip protocol\nGossip protocol': [0.1, 0.995],
};
const embedder: Embedder = { embed: async (texts) => texts.map((text) => Float32Array.from(vectors[text] ?? [1, 0])) };
const queue = (model?: Parameters<typeof decideConceptMerges>[3]) => new JobQueue(db, () => now, {
  page_enrichment: async () => { throw new Error('Unexpected Page enrichment'); },
  expedition_wrap_up: async () => { throw new Error('Unexpected wrap-up'); },
  field_notes: async () => { throw new Error('Unexpected field notes'); },
  thread_match: async () => { throw new Error('Unexpected Thread matching'); },
  living_note: async () => { throw new Error('Unexpected living note'); },
  notes_enrichment: async () => { throw new Error('Unexpected notes enrichment'); },
  concept_resolution: resolveConcepts(db, embedder, () => now),
  merge_verdict: decideConceptMerges(db, () => ({ paused: false, skippedHosts: [] }), () => now, model),
}, [db.visits, db.pages, db.concepts, db.conceptEvidence, db.edges]);

async function enriched(id: string, concepts: NonNullable<Page['conceptMentions']>, opts: {
  pageId?: string; engagement?: Visit['engagement']; relations?: Page['relationMentions']; expeditionId?: string;
  enrichmentSources?: Page['enrichmentSources'];
} = {}) {
  const url = `https://learn.example/${opts.pageId ?? id}`;
  const visit: Visit = {
    id, canonicalUrl: url, url, title: `Title ${id}`, tabId: 1, parentVisitId: null, transition: 'link',
    startedAt: now++, activeMs: 0, scrollDepth: 0, engagement: opts.engagement ?? 'skimmed', expeditionId: opts.expeditionId ?? 'e1',
  };
  const page: Page = {
    canonicalUrl: url, sourceUrl: url, sourceVisitId: id, text: 'An article', textHash: id,
    summary: 'Summary', takeaways: [], embedding: null, pageKind: 'article', enrichedAt: now,
    enrichmentVisitId: id, enrichmentSources: opts.enrichmentSources, conceptMentions: concepts, relationMentions: opts.relations ?? [],
  };
  await db.visits.put(visit);
  await db.pages.put(page);
  await enqueueConceptResolution(db, page, now);
  if (concepts.length) expect(await queue().runNext()).toBe(true);
  return visit;
}

test('exact names resolve together, but only distinct evidence Pages make a skimmed Concept visible', async () => {
  await enriched('a', [mention('Tombstone'), mention('Software')]);
  await enriched('b', [mention(' TOMBSTONE '), mention('Software')], { pageId: 'a' });
  expect(await readVisibleConcepts(db)).toEqual([]);
  await enriched('c', [mention('tombstone'), mention('Software')]);
  const visible = await readVisibleConcepts(db);
  expect(visible).toHaveLength(1);
  expect(visible[0]).toMatchObject({ name: 'Tombstone', exposure: 2, firstSeen: 1_000 });
  const evidence = await readConceptEvidence(db, visible[0]!.id);
  expect(evidence.map(({ page, visits }) => [page.canonicalUrl, visits.map(({ visit }) => visit.id)]))
    .toEqual([['https://learn.example/a', ['a', 'b']], ['https://learn.example/c', ['c']]]);
});

test('a close cosine creates an alias, an exact alias overrides cosine, and distant concepts stay distinct', async () => {
  await enriched('a', [mention('Tombstone', 'explains')], { engagement: 'read' });
  await enriched('b', [mention('Deferred deletion')]);
  await enriched('c', [mention('Deferred deletion', 'uses', 'Alternative gloss'), mention('Gossip protocol', 'explains')], {
    engagement: 'read', relations: [
      { from: 'Gossip protocol', to: 'Deferred deletion', type: 'uses' },
      { from: 'Gossip protocol', to: 'Not present', type: 'is_a' },
    ],
  });
  const { concepts, edges } = await readVisibleConceptGraph(db);
  expect(concepts.map(({ name }) => name).sort()).toEqual(['Gossip protocol', 'Tombstone']);
  const tombstone = concepts.find((c) => c.name === 'Tombstone')!;
  const gossip = concepts.find((c) => c.name === 'Gossip protocol')!;
  expect(tombstone).toMatchObject({ aliases: ['Deferred deletion'], exposure: 3 });
  expect(edges.map(({ from, to, type, evidence }) => ({ from, to, type, evidence }))).toEqual(expect.arrayContaining([
    { from: 'a', to: tombstone.id, type: 'teaches', evidence: ['a'] },
    { from: 'b', to: tombstone.id, type: 'mentions', evidence: ['b'] },
    { from: 'c', to: tombstone.id, type: 'mentions', evidence: ['c'] },
    { from: 'c', to: gossip.id, type: 'teaches', evidence: ['c'] },
    { from: gossip.id, to: tombstone.id, type: 'uses', evidence: ['c'] },
  ]));
  expect(edges).toHaveLength(5);
});

test('one queued verdict batch handles same, broader, narrower, related and different', async () => {
  vectors['Tombstone\nTombstone'] = [1, 0, 0, 0, 0, 0];
  await enriched('a', [mention('Tombstone', 'explains')], { engagement: 'read' });
  const names = ['Delete record', 'Deletion method', 'Vector marker', 'Replica timestamp', 'Recovery point'];
  // All candidates are in the uncertain band relative to Tombstone, but distant from one another.
  names.forEach((name, i) => { vectors[`${name}\n${name}`] = Array.from({ length: 6 }, (_, j) => j === 0 ? 0.85 : j === i + 1 ? Math.sqrt(1 - 0.85 ** 2) : 0); });
  await enriched('b', names.map((name) => mention(name, 'explains')), { engagement: 'read' });
  let calls = 0;
  const verdicts = queue(async (_db, request, guard) => {
    calls++;
    expect(await guard.allow()).toBe(true);
    const pairs = JSON.parse(request.input as string).pairs as { id: string; candidate: { name: string }; existing: { name: string } }[];
    expect(pairs.map(({ candidate, existing }) => [candidate.name, existing.name])).toEqual(names.map((name) => [name, 'Tombstone']));
    const results = ['same', 'broader', 'narrower', 'related', 'different'];
    return { output: { verdicts: pairs.map(({ id }, i) => ({ id, verdict: results[i] })) } };
  });
  expect(await verdicts.runNext()).toBe(true);
  expect(await verdicts.runNext()).toBe(false);
  expect(calls).toBe(1);
  const { concepts, edges } = await readVisibleConceptGraph(db);
  const namesById = new Map(concepts.map(({ name, id }) => [id, name]));
  expect(concepts.find(({ name }) => name === 'Tombstone')).toMatchObject({ exposure: 2, aliases: ['Delete record'] });
  expect(concepts.some(({ name }) => name === 'Delete record')).toBe(false);
  expect(edges.filter(({ evidence }) => evidence.length === 2).map(({ from, to, type, evidence }) =>
    [namesById.get(from), type, namesById.get(to), evidence])).toEqual(expect.arrayContaining([
    ['Tombstone', 'is_a', 'Deletion method', ['a', 'b']],
    ['Vector marker', 'is_a', 'Tombstone', ['a', 'b']],
    ['Replica timestamp', 'related_to', 'Tombstone', ['a', 'b']],
  ]));
  expect(edges.filter(({ evidence }) => evidence.length === 2)).toHaveLength(3);
});

test('a merge verdict audits the Visits behind the enrichment of both Concepts', async () => {
  vectors['Borderline\nBorderline'] = [0.85, Math.sqrt(1 - 0.85 ** 2)];
  const parent = await enriched('parent', []);
  await enriched('a', [mention('Tombstone')], { enrichmentSources: { visitIds: [parent.id], canonicalUrls: [parent.url] } });
  await enriched('b', [mention('Borderline')]);
  const ids: string[][] = [];
  await queue(async (_db, _request, guard) => {
    expect(await guard.allow()).toBe(true);
    ids.push(guard.visitIds?.slice().sort() ?? []);
    return { output: { verdicts: [{ id: 'p1', verdict: 'related' }] } };
  }).runNext();
  expect(ids).toEqual([['a', 'b', 'parent']]);
});

test('Forget re-scores surviving Concepts and Edges and removes text supported only by forgotten Visits', async () => {
  vectors['Only on forgotten page\nOnly on forgotten page'] = [0, 0, 1];
  vectors['Vector clock\nVector clock'] = [0, 1, 0];
  vectors['Tombstone\nForgotten gloss'] = [1, 0, 0];
  const lost = await enriched('lost', [mention('Tombstone', 'explains', 'Forgotten gloss'), mention('Only on forgotten page', 'explains'), mention('Vector clock', 'explains')], {
    engagement: 'read', relations: [{ from: 'Tombstone', to: 'Vector clock', type: 'related_to' }],
  });
  const kept = await enriched('kept', [mention('Tombstone'), mention('Vector clock', 'explains')], {
    engagement: 'read', relations: [{ from: 'Tombstone', to: 'Vector clock', type: 'related_to' }],
  });
  const { concepts, edges } = await readVisibleConceptGraph(db);
  const tombstone = concepts.find(({ name }) => name === 'Tombstone')!;
  const relation = edges.find(({ type }) => type === 'related_to')!;
  expect(relation).toMatchObject({ weight: 2, evidence: ['kept', 'lost'] });
  await forgetCascade(db, { kind: 'forget-page', visitIds: [lost.id], now: () => now, newId: () => 'forget-log' });
  expect((await readVisibleConcepts(db)).map(({ name }) => name)).toEqual(['Vector clock']);
  expect(await db.concepts.get(tombstone.id)).toMatchObject({ firstSeen: kept.startedAt, exposure: 1, gloss: 'Tombstone' });
  expect(await db.edges.get(relation.id)).toMatchObject({ evidence: ['kept'], weight: 1 });
  expect(await readConceptEvidence(db, tombstone.id)).toMatchObject([{ page: { canonicalUrl: kept.canonicalUrl }, visits: [{ visit: { id: 'kept' } }] }]);
  const all = JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));
  expect(all).not.toContain('Forgotten gloss');
  expect(all).not.toContain('Only on forgotten page');
});

test('Expedition rankings follow Visit membership, and the note renders a Concept with clickable evidence', async () => {
  await enriched('a', [mention('Tombstone', 'explains'), mention('Gossip protocol', 'explains')], { engagement: 'read' });
  const second = await enriched('b', [mention('Gossip protocol')], { expeditionId: 'e2' });
  expect((await readExpeditionTopConcepts(db, 'e1')).map((c) => c.name)).toEqual(['Gossip protocol', 'Tombstone']);
  await db.visits.update(second.id, { expeditionId: 'e1' });
  const [top] = await readExpeditionTopConcepts(db, 'e1', 1);
  expect(top?.name).toBe('Gossip protocol');
  expect(await readExpeditionTopConcepts(db, 'e2')).toEqual([]);
  const note = renderConceptNote(top!, await readConceptEvidence(db, top!.id));
  expect(note).toContain('# Gossip protocol');
  expect(note).toContain('[Title a](<https://learn.example/a>)');
  expect(note).toContain('[Title b](<https://learn.example/b>)');
});

test('Forget fences a leased verdict and purges its multi-Visit audit, even when the Page survives', async () => {
  vectors['Borderline\nBorderline'] = [0.85, Math.sqrt(1 - 0.85 ** 2)];
  const lost = await enriched('lost', [mention('Tombstone', 'explains')], { engagement: 'read' });
  const survivor = await enriched('survivor', [], { pageId: 'lost', expeditionId: 'e2', engagement: 'read' });
  // The surviving Visit did not produce these mentions or this Page enrichment.
  await db.pages.update(lost.canonicalUrl, { enrichmentVisitId: lost.id, conceptMentions: [mention('Tombstone', 'explains')] });
  await enriched('b', [mention('Borderline', 'explains')], { engagement: 'read' });
  const dispatched = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const running = queue(async (modelDb, request, guard) => {
    expect(await guard.allow()).toBe(true);
    await modelDb.sentToModel.add({ id: 'verdict', task: request.task, at: now, provider: 'test', model: 'test',
      instructions: request.instructions, input: [{ role: 'user', content: request.input }],
      visitIds: guard.visitIds, canonicalUrls: guard.canonicalUrls });
    dispatched.resolve();
    await finish.promise;
    return { output: { verdicts: [{ id: 'p1', verdict: 'same' }] } };
  }).runNext();
  await Promise.race([dispatched.promise, running.then(() => { throw new Error('Verdict did not dispatch'); })]);
  let logId = 0;
  await forgetCascade(db, { kind: 'forget-expedition', visitIds: [lost.id], now: () => now, newId: () => `log-${++logId}` });
  finish.resolve();
  await running;
  expect(await db.pages.get(survivor.canonicalUrl)).toMatchObject({ enrichedAt: null });
  expect((await db.pages.get(survivor.canonicalUrl))?.conceptMentions).toBeUndefined();
  expect(await db.sentToModel.get('verdict')).toBeUndefined();
  expect((await readVisibleConcepts(db)).map(({ name }) => name)).toEqual(['Borderline']);
  expect(await db.jobs.filter(({ kind }) => kind === 'merge_verdict').count()).toBe(0);
});

test('Forget removes an inferred relation without mistaking its other input for independent support', async () => {
  vectors['Borderline\nBorderline'] = [0.85, Math.sqrt(1 - 0.85 ** 2)];
  const lost = await enriched('lost', [mention('Tombstone', 'explains')], { engagement: 'read' });
  await enriched('b', [mention('Borderline', 'explains')], { engagement: 'read' });
  const verdict = queue(async () => ({ output: { verdicts: [{ id: 'p1', verdict: 'related' }] } }));
  expect(await verdict.runNext()).toBe(true);
  await enriched('c', [mention('Tombstone', 'explains')], { engagement: 'read' });
  expect((await readVisibleConceptGraph(db)).edges.filter(({ type }) => type === 'related_to')).toHaveLength(1);
  await forgetCascade(db, { kind: 'forget-page', visitIds: [lost.id], now: () => now, newId: () => 'forget-log' });
  const { concepts, edges } = await readVisibleConceptGraph(db);
  expect(concepts.map(({ name }) => name).sort()).toEqual(['Borderline', 'Tombstone']);
  expect(edges.filter(({ type }) => type === 'related_to')).toEqual([]);
});
