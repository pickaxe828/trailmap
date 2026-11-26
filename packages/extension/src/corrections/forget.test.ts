import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Expedition, Page, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { createCorrections } from './corrections';

let db: ReturnType<typeof openTrailmapDb>;
let ids: number;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); ids = 0; });
afterEach(() => db.delete());
const corrections = () => createCorrections({ db, now: () => 5_000 + ids, newId: () => `id-${++ids}` });

const SECRET = 'zebra-finance-secret';
const visit = (id: string, host: string, extra: Partial<Visit> = {}): Visit => ({
  id, url: `https://${host}/${id}`, canonicalUrl: `https://${host}/${id}`, title: `Title ${id}`, tabId: 1,
  parentVisitId: null, transition: 'link', startedAt: 100, activeMs: 0, scrollDepth: 0, engagement: 'read',
  expeditionId: 'e1', ...extra,
});
const expedition = (id: string, extra: Partial<Expedition> = {}): Expedition => ({
  id, rootVisitId: undefined, centroid: null, title: `Expedition ${id}`, drivingQuestion: null, kind: 'learning',
  startedAt: 100, endedAt: null, fieldNotes: null, userEdited: false, threadId: null, ...extra,
});
const page = (url: string, extra: Partial<Page> = {}): Page => ({
  canonicalUrl: url, text: `body of ${url} ${url.includes('secret.example') ? SECRET : ''}`, textHash: 'h',
  summary: `summary ${url.includes('secret.example') ? SECRET : ''}`, takeaways: [url.includes('secret.example') ? SECRET : 'ok'],
  embedding: null, pageKind: 'article', enrichedAt: 1, ...extra,
});

/** e1: secret.example (root, with Query) -> a.example; e2: b.example plus a second visit to the secret page. */
async function seed() {
  await db.expeditions.bulkPut([
    expedition('e1', { rootVisitId: 's', title: `search ${SECRET}`, fieldNotes: 'field notes', unseenNotes: 1, notesWrittenAt: 9,
      mergeSuggestions: [{ expeditionId: 'e2', reason: SECRET }] }),
    expedition('e2', { rootVisitId: 'b', title: 'Other' }),
  ]);
  await db.visits.bulkPut([
    visit('s', 'secret.example', { startedAt: 100 }),
    visit('a', 'a.example', { startedAt: 200, parentVisitId: 's' }),
    visit('b', 'b.example', { expeditionId: 'e2', startedAt: 150 }),
    visit('s2', 'secret.example', { expeditionId: 'e2', startedAt: 300, canonicalUrl: 'https://secret.example/s' }),
  ]);
  await db.queries.put({ id: 'q-s', visitId: 's', engine: 'google', q: SECRET, at: 100, expeditionId: 'e1' });
  await db.pages.bulkPut([
    page('https://secret.example/s'), page('https://a.example/a', { summary: 'a notes' }), page('https://b.example/b'),
  ]);
  await db.highlights.bulkPut([
    { id: 'h1', visitId: 's', canonicalUrl: 'https://secret.example/s', text: SECRET, at: 1, source: 'selection' },
    { id: 'h2', visitId: 'a', canonicalUrl: 'https://a.example/a', text: 'keep me', at: 1, source: 'copy' },
  ]);
  await db.notes.bulkPut([
    { id: 'n1', nodeId: 's', text: SECRET, at: 1 }, { id: 'n2', nodeId: 'a', text: 'keep note', at: 1 },
    { id: 'n3', nodeId: 'q-s', text: SECRET, at: 1 },
  ]);
  await db.jobs.bulkPut([
    { id: 'j1', kind: 'page_enrichment', key: 'k1', priority: 0, createdAt: 1, status: 'pending', availableAt: 1, failures: 0,
      payload: { canonicalUrl: 'https://secret.example/s', textHash: 'h', visitId: 's' } },
    { id: 'j2', kind: 'page_enrichment', key: 'k2', priority: 0, createdAt: 1, status: 'done', availableAt: 1, failures: 0,
      payload: { canonicalUrl: 'https://a.example/a', textHash: 'h', visitId: 'a' } },
    { id: 'j3', kind: 'field_notes', key: 'k3', priority: 1, createdAt: 1, status: 'pending', availableAt: 1, failures: 0,
      payload: { expeditionId: 'e1', endedAt: 5, revision: 0 } },
  ]);
  const sent = { provider: 'p', model: 'm', instructions: 'i', input: [{ role: 'user' as const, content: SECRET }] };
  await db.sentToModel.bulkPut([
    { id: 'm1', at: 1, task: 'page_enrichment', canonicalUrl: 'https://secret.example/s', ...sent },
    { id: 'm3', at: 3, task: 'field_notes', expeditionId: 'e1', ...sent,
      canonicalUrls: ['https://secret.example/s', 'https://a.example/a'] },
    { id: 'm2', at: 2, task: 'page_enrichment', canonicalUrl: 'https://a.example/a', ...sent, input: [{ role: 'user', content: 'fine' }] },
  ]);
  await db.edges.bulkPut([
    { id: 'edge1', from: 's', to: 'a', type: 'navigated_from', weight: 1, evidence: ['s', 'a'] },
    { id: 'edge2', from: 'c1', to: 'c2', type: 'teaches', weight: 1, evidence: ['s', 'a'] },
    { id: 'edge3', from: 'c1', to: 'c3', type: 'uses', weight: 1, evidence: ['s'] },
  ]);
  const c = corrections();
  await c.note('s', SECRET); // creates a log entry that mentions the secret
  await c.star('a', true);
}

async function everything() {
  const rows = await Promise.all(db.tables.map((t) => t.toArray()));
  return JSON.stringify(rows);
}

test('forgetting a Page removes its Visits, Query, Highlights, Notes, jobs, audit rows and log entries everywhere', async () => {
  await seed();
  await corrections().forgetPage('https://secret.example/s');

  const left = await everything();
  expect(left).not.toContain(SECRET);
  expect(left).not.toContain('secret.example');
  expect((await db.visits.toArray()).map((v) => v.id).sort()).toEqual(['a', 'b']);
  expect((await db.pages.toArray()).map((p) => p.canonicalUrl).sort()).toEqual(['https://a.example/a', 'https://b.example/b']);
  expect((await db.highlights.toArray()).map((h) => h.id)).toEqual(['h2']);
  expect((await db.notes.toArray()).map((n) => n.id).sort()).toEqual(['n2']);
  expect((await db.jobs.toArray()).map((j) => j.id).sort()).toEqual(['j2', 'j3']);
  expect((await db.sentToModel.toArray()).map((row) => row.id)).not.toContain('m3'); // it quoted the forgotten Page
  expect(await db.queries.count()).toBe(0);
  // Edges that depended on the forgotten Visit lose it; an edge left without evidence goes away.
  expect((await db.edges.toArray()).map((e) => [e.id, e.evidence])).toEqual([['edge2', ['a']]]);
  // e1 lost its root and its derived, non-user fields; e2 is untouched.
  expect(await db.expeditions.get('e1')).toMatchObject({ rootVisitId: 'a', title: 'Title a', fieldNotes: null, mergeSuggestions: [] });
  expect((await db.expeditions.get('e1'))!.unseenNotes).toBeUndefined();
  expect(await db.expeditions.get('e2')).toMatchObject({ rootVisitId: 'b', title: 'Other' });
});

test('forgetting records that audit rows were removed without keeping their content, and logs the forget with counts only', async () => {
  await seed();
  await corrections().forgetPage('https://secret.example/s');

  const audit = await db.sentToModel.orderBy('at').toArray();
  expect(audit.map((row) => row.id)).toContain('m2');
  expect(audit.map((row) => row.id)).not.toContain('m1');
  const tombstone = audit.find((row) => row.task === 'forgotten')!;
  expect(tombstone.instructions).toMatch(/2 .*removed/);
  expect(tombstone.canonicalUrl).toBeUndefined();
  const forgotten = (await db.corrections.toArray()).find((entry) => entry.kind === 'forget-page')!;
  expect(forgotten.targetIds).toEqual([]);
  expect(forgotten.before).toMatchObject({ visits: 2, pages: 1, highlights: 1, notes: 2, jobs: 1, auditRows: 2 });
  expect(forgotten.after).toBeNull();
  expect((await db.corrections.toArray()).some((e) => e.kind === 'star')).toBe(true); // unrelated entries stay
});

test('forgetting an Expedition keeps a shared Page only if it has surviving capture provenance', async () => {
  await seed();
  await db.pages.update('https://secret.example/s', { sourceVisitId: 's2' });
  const { visitIds } = await corrections().forgetExpedition('e1');
  expect(visitIds.sort()).toEqual(['a', 's']);

  expect(await db.expeditions.get('e1')).toBeUndefined();
  expect((await db.visits.toArray()).map((v) => v.id).sort()).toEqual(['b', 's2']);
  // s2 still visited the secret Page, so its text and audit rows stay until that visit is forgotten too.
  expect((await db.pages.get('https://secret.example/s'))).toBeDefined();
  expect((await db.pages.get('https://a.example/a'))).toBeUndefined();
  expect(await db.queries.count()).toBe(0);
  expect((await db.jobs.get('j3'))).toBeUndefined(); // the forgotten Expedition's field-notes job
  expect((await db.highlights.get('h1'))).toBeUndefined();
  await corrections().forgetExpedition('e2');
  expect(await everything()).not.toContain('secret.example');
});

test('forgetting a session removes its contribution from a surviving thread and its living-note audit', async () => {
  const threadId = 'thread';
  const sessions = ['forgotten', 'second', 'third'];
  await db.expeditions.bulkAdd(sessions.map((id, i) => expedition(id, { threadId, rootVisitId: id, startedAt: i, endedAt: i + 1,
    ...(i === 0 ? { title: SECRET, fieldNotes: SECRET } : { fieldNotes: 'Other field notes' }),
  })));
  await db.visits.bulkAdd(sessions.map((id) => visit(id, 'learn.example', { expeditionId: id })));
  await db.threads.add({ id: threadId, title: SECRET, question: SECRET, status: 'active', lastActiveAt: 3,
    livingNote: SECRET, centroid: null, conceptIds: [], notedExpeditionIds: sessions });
  await db.sentToModel.add({ id: 'living', task: 'living_note', at: 5, provider: 'fixture', model: 'fixture', instructions: 'Update',
    input: [{ role: 'user', content: SECRET }], expeditionId: 'third', visitIds: sessions });

  await corrections().forgetExpedition('forgotten');
  expect(await everything()).not.toContain(SECRET);
  expect(await db.threads.get(threadId)).toMatchObject({ title: 'Expedition second', livingNote: null, notedExpeditionIds: [] });
  expect((await db.jobs.toArray()).map(({ kind }) => kind)).toEqual(['living_note']);
});

test('forgetting a site removes every Visit and Page on that host and its subdomains', async () => {
  await seed();
  await db.pages.put(page('https://docs.secret.example/only-highlight', { sourceUrl: 'https://docs.secret.example/only-highlight' }));
  await db.visits.put(visit('sub', 'docs.secret.example', { expeditionId: 'e2' }));
  await db.visits.put(visit('lookalike', 'notsecret.example', { expeditionId: 'e2' }));
  await corrections().forgetSite('secret.example');

  expect((await db.visits.toArray()).map((v) => v.id).sort()).toEqual(['a', 'b', 'lookalike']);
  expect(await db.pages.get('https://docs.secret.example/only-highlight')).toBeUndefined();
  expect(await everything()).not.toContain('//secret.example');
});

test('Forget Site keeps an allowed alias Visit but purges its forgotten shared Page capture', async () => {
  const allowed = visit('allowed', 'learn.example', { expeditionId: null });
  const secret = visit('secret', 'secret.example', { canonicalUrl: allowed.canonicalUrl, expeditionId: null });
  await db.visits.bulkAdd([allowed, secret, visit('history:42', 'secret.example', { expeditionId: null })]);
  await db.pages.add(page(allowed.canonicalUrl, { sourceUrl: secret.url, sourceVisitId: secret.id, text: SECRET, enrichedAt: null }));
  await corrections().forgetSite('secret.example');
  expect(await db.visits.toArray()).toEqual([allowed]);
  expect(await db.pages.count()).toBe(0);
  expect(await db.jobs.count()).toBe(0);
  expect(await everything()).not.toContain(SECRET);
});

test('Forget clears an errand title derived from a non-root Visit', async () => {
  await db.visits.bulkAdd([visit('root', 'learn.example'), visit('secret', 'secret.example')]);
  await db.expeditions.add(expedition('e1', { rootVisitId: 'root', endedAt: 200, kind: 'errand', wrappedUpAt: 300,
    title: SECRET, drivingQuestion: SECRET }));
  await corrections().forgetSite('secret.example');
  expect(await db.expeditions.get('e1')).toMatchObject({ title: 'Title root', drivingQuestion: null });
  expect(await everything()).not.toContain(SECRET);
});

test('Forget purges the split snapshots for moved descendants and renames of indirectly deleted Expeditions', async () => {
  const c = corrections();
  await db.expeditions.add(expedition('e1', { rootVisitId: 'root' }));
  await db.visits.bulkAdd([visit('root', 'learn.example'), visit('branch', 'learn.example', { parentVisitId: 'root' }),
    visit('secret', 'secret.example', { parentVisitId: 'branch' })]);
  const splitId = (await c.split('branch'))!;
  await c.rename(splitId, SECRET);
  await c.forgetSite('secret.example');
  expect((await db.corrections.toArray()).map(({ kind }) => kind)).not.toContain('split');
  await c.forgetPage('https://learn.example/branch');
  expect(await db.expeditions.get(splitId)).toBeUndefined();
  expect(await everything()).not.toContain(SECRET);
});

test('a surviving independent capture can still be queued for enrichment', async () => {
  await seed();
  await db.pages.update('https://secret.example/s', { enrichedAt: null, sourceUrl: 'https://secret.example/s', sourceVisitId: 's2' });
  await corrections().forgetExpedition('e1');
  const jobs = await db.jobs.toArray();
  expect(jobs.flatMap(({ payload }) => 'canonicalUrl' in payload && payload.canonicalUrl === 'https://secret.example/s' ? [payload.visitId] : [])).toEqual(['s2']);
});
