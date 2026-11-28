import { expect, test } from 'bun:test';
import type { Expedition, Page, Visit } from '@trailmap/shared';
import { createCorrections } from '../corrections/corrections';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import type { RecordingSettings } from '../privacy/policy';
import { observeSearchCorpus } from '../search/corpus';
import { SearchIndex } from '../search/index';
import type { ModelRequester } from '../wrapup/handlers';
import { ask, type AskDeps } from './ask';

const settings: RecordingSettings = { paused: false, skippedHosts: [] };
const nothing = { status: 'nothing' } as const;
const CRDT = 'https://learn.test/crdts';
const LSM = 'https://papers.test/lsm';

const visit = (id: string, url: string, extra: Partial<Visit> = {}): Visit => ({
  id, tabId: 1, url, canonicalUrl: url, title: id, parentVisitId: null, transition: 'link', startedAt: 1, activeMs: 70_000,
  scrollDepth: 1, engagement: 'read', expeditionId: null, ...extra,
});
const page = (url: string, text: string, sourceVisitId: string): Page => ({
  canonicalUrl: url, sourceUrl: url, sourceVisitId, text, textHash: url, summary: null, takeaways: [], embedding: null, pageKind: null, enrichedAt: null,
});
const expedition = (id: string, extra: Partial<Expedition> = {}): Expedition => ({
  id, title: `Expedition ${id}`, drivingQuestion: null, kind: 'learning', startedAt: 1, endedAt: 2, fieldNotes: null, userEdited: false, threadId: null, ...extra,
});

async function seed(db: TrailmapDb) {
  await db.visits.bulkAdd([visit('crdt', CRDT, { title: 'Replicated lists', expeditionId: 'e1' }), visit('lsm', LSM, { title: 'LSM trees', pdf: true })]);
  await db.pages.bulkAdd([
    page(CRDT, 'Tombstones mark deleted items so replicas converge.\n\nGarbage collection of tombstones needs causal stability.', 'crdt'),
    page(LSM, 'A memtable buffers writes before they are flushed to sorted runs.', 'lsm'),
  ]);
  await db.expeditions.add(expedition('e1', { title: 'CRDT research' }));
}

/** The index is built once, like the live one: asking later must not trust what it knew then. */
async function indexed(db: TrailmapDb): Promise<AskDeps['rank']> {
  const index = new SearchIndex({ async embed() { return []; } });
  const documents = await new Promise<Parameters<SearchIndex['update']>[0]>((resolve, reject) => {
    const subscription = observeSearchCorpus(db).subscribe({ next: (docs) => { resolve(docs); queueMicrotask(() => subscription.unsubscribe()); }, error: reject });
  });
  index.update(documents);
  return async (question) => (await index.search(question, 60)).map(({ id }) => id);
}

type Call = { input: { question: string; passages: { ref: string; kind: string; title: string; text: string }[] }; guard: Parameters<ModelRequester>[2] };
function fakeModel(reply: (call: Call) => unknown = ({ input }) => ({ answerable: true, answer: 'Tombstones mark deleted items.', sources: [input.passages[0]!.ref] })) {
  const calls: Call[] = [];
  const request: ModelRequester = async (_db, payload, guard) => {
    if (!await guard.allow()) throw new Error('refused');
    const call = { input: JSON.parse(payload.input), guard };
    calls.push(call);
    return { output: reply(call) };
  };
  return { calls, request };
}

async function withDb<T>(run: (db: TrailmapDb) => Promise<T>) {
  const db = openTrailmapDb(crypto.randomUUID());
  try { return await run(db); } finally { await db.delete(); }
}
async function setup(db: TrailmapDb, options: { settings?: RecordingSettings; model?: ReturnType<typeof fakeModel> } = {}) {
  const model = options.model ?? fakeModel();
  let current = options.settings ?? settings;
  const deps: AskDeps = { db, getSettings: () => current, rank: await indexed(db), request: model.request, readRoute: async () => ({ provider: 'anthropic' }) };
  return { model, deps, set: (next: RecordingSettings) => { current = next; } };
}

test('a question is answered from the matching page, cites it, and makes exactly one model call', () => withDb(async (db) => {
  await seed(db);
  const { model, deps } = await setup(db);
  const reply = await ask(deps, 'How do tombstones work in a CRDT?');
  expect(reply).toEqual({ status: 'answered', answer: 'Tombstones mark deleted items.',
    citations: [{ kind: 'page', id: CRDT, title: 'Replicated lists', href: CRDT }] });
  expect(model.calls).toHaveLength(1);
  const { input, guard } = model.calls[0]!;
  expect(input.passages.map(({ title }) => title)).toEqual(['Replicated lists']);
  expect(input.passages[0]!.text).toContain('Tombstones mark deleted items');
  expect(input.passages.some(({ text }) => text.includes('memtable'))).toBe(false);
  expect(guard.canonicalUrls).toEqual([CRDT]);
  expect(guard.visitIds).toEqual(['crdt']);
}));

test('an unrelated question says there is nothing in the trails, without calling the model', () => withDb(async (db) => {
  await seed(db);
  const { model, deps } = await setup(db);
  expect(await ask(deps, 'What is the capital of France?')).toEqual(nothing);
  expect(await ask(deps, 'what is the')).toEqual(nothing);
  expect(model.calls).toHaveLength(0);
}));

test('the model saying the passages do not answer it is also nothing', () => withDb(async (db) => {
  await seed(db);
  const { deps } = await setup(db, { model: fakeModel(() => ({ answerable: false, answer: '', sources: [] })) });
  expect(await ask(deps, 'How do tombstones work?')).toEqual(nothing);
}));

test('citations are only the passages that were sent: unknown refs are dropped, and an answer citing none is not shown', () => withDb(async (db) => {
  await seed(db);
  const mixed = await setup(db, { model: fakeModel(() => ({ answerable: true, answer: 'Deleted items stay marked.', sources: ['p9', 'https://evil.test/', 'p1', 'p1'] })) });
  expect(await ask(mixed.deps, 'How do tombstones work?')).toEqual({ status: 'answered', answer: 'Deleted items stay marked.',
    citations: [{ kind: 'page', id: CRDT, title: 'Replicated lists', href: CRDT }] });
  const invented = await setup(db, { model: fakeModel(() => ({ answerable: true, answer: 'From memory.', sources: ['p7', 'LSM trees'] })) });
  expect(await ask(invented.deps, 'How do tombstones work?')).toEqual(nothing);
  const malformed = await setup(db, { model: fakeModel(() => ({ answer: 3 })) });
  expect(await ask(malformed.deps, 'How do tombstones work?')).toMatchObject({ status: 'error', code: 'invalid_output' });
}));

test('page notes, My notes and concepts are retrieved too, and cite their expedition', () => withDb(async (db) => {
  await seed(db);
  await db.expeditions.update('e1', { fieldNotes: 'Found that quorum reads need overlapping replicas.', notesSource: { visitIds: ['crdt'], canonicalUrls: [CRDT, 'https://learn.test/crdts'] },
    myNotes: 'My hunch: vector clocks beat lamport clocks here.' });
  const { model, deps } = await setup(db, { model: fakeModel(({ input }) => ({ answerable: true, answer: 'See notes.', sources: input.passages.map(({ ref }) => ref) })) });
  const reply = await ask(deps, 'Do quorum reads and vector clocks matter?');
  expect(reply).toMatchObject({ status: 'answered' });
  expect(model.calls[0]!.input.passages.map(({ kind }) => kind).sort()).toEqual(['field notes', 'my notes']);
  expect(reply.status === 'answered' && reply.citations).toEqual([{ kind: 'expedition', id: 'e1', title: 'CRDT research', href: '/expedition.html?id=e1' }]);
  expect(model.calls[0]!.guard.expeditionIds).toEqual(['e1']);
}));

test('My notes are not sent when "Use my notes" is off, and field notes are not sent after one of their pages is skipped', () => withDb(async (db) => {
  await seed(db);
  await db.expeditions.update('e1', { fieldNotes: 'Found that quorum reads need overlapping replicas.', notesSource: { visitIds: ['crdt'], canonicalUrls: [CRDT] },
    myNotes: 'My hunch: vector clocks beat lamport clocks here.' });
  const off = await setup(db, { settings: { ...settings, useMyNotes: false } });
  await ask(off.deps, 'vector clocks');
  expect(off.model.calls).toHaveLength(0);
  const skipped = await setup(db, { settings: { ...settings, skippedHosts: ['learn.test'] } });
  expect(await ask(skipped.deps, 'quorum reads')).toEqual(nothing);
  expect(skipped.model.calls).toHaveLength(0);
}));

test('skipped, denied, private, bounced and paused content is never retrieved', () => withDb(async (db) => {
  await seed(db);
  await db.visits.bulkAdd([
    visit('local', 'http://localhost:3000/tombstones'), visit('bank', 'https://bank.test/tombstones', { privacyBlocked: true }),
    visit('bounce', 'https://bounce.test/tombstones', { engagement: 'bounced' }), visit('own', 'https://skip.test/tombstones'),
  ]);
  await db.pages.bulkAdd([page('http://localhost:3000/tombstones', 'tombstones local secret', 'local'),
    page('https://bank.test/tombstones', 'tombstones bank secret', 'bank'), page('https://bounce.test/tombstones', 'tombstones bounced secret', 'bounce'),
    page('https://skip.test/tombstones', 'tombstones skipped secret', 'own')]);
  const { model, deps, set } = await setup(db, { settings: { ...settings, skippedHosts: ['skip.test'] } });
  await ask(deps, 'tombstones');
  const sent = JSON.stringify(model.calls.map(({ input }) => input));
  expect(sent).toContain('Tombstones mark deleted items');
  for (const secret of ['local secret', 'bank secret', 'bounced secret', 'skipped secret']) expect(sent).not.toContain(secret);
  set({ ...settings, paused: true });
  model.calls.length = 0;
  expect(await ask(deps, 'tombstones')).toEqual(nothing);
  expect(model.calls).toHaveLength(0);
}));

test('content forgotten after it was indexed is not sent, even though the index still ranks it', () => withDb(async (db) => {
  await seed(db);
  const { model, deps } = await setup(db);
  await createCorrections({ db, now: () => 10, newId: () => crypto.randomUUID() }).forgetPage(CRDT);
  expect(await ask(deps, 'How do tombstones work?')).toEqual(nothing);
  expect(model.calls).toHaveLength(0);
}));

test('content forgotten while the request is being prepared is refused at dispatch', () => withDb(async (db) => {
  await seed(db);
  const request: ModelRequester = async (_db, _payload, guard) => {
    await createCorrections({ db, now: () => 10, newId: () => crypto.randomUUID() }).forgetPage(CRDT);
    expect(await guard.allow()).toBe(false);
    throw new Error('not sent');
  };
  const { deps } = await setup(db);
  expect(await ask({ ...deps, request }, 'How do tombstones work?')).toMatchObject({ status: 'error', code: 'internal' });
}));

test('chat conversations count only while their site is opted in; Reddit threads only while Reddit is', () => withDb(async (db) => {
  const chat = 'https://claude.ai/.trailmap-chat/c1';
  const thread = 'https://www.reddit.com/r/databases/comments/abc/lsm_or_btree/';
  await db.visits.bulkAdd([visit('chat', chat, { aiConversation: true, title: 'Claude chat', expeditionId: 'e1' }), visit('forum', thread, { title: 'LSM or B-tree' })]);
  await db.pages.bulkAdd([{ ...page(chat, 'Q: raft leader election\nA: Raft elects a leader with randomized timeouts.', 'chat'),
    aiTurns: [{ id: 't1', question: 'raft leader election', answer: 'Raft elects a leader with randomized timeouts.', citations: [] }] },
  page(thread, 'Commenters prefer a B-tree for read-heavy workloads.', 'forum')]);
  await db.expeditions.add(expedition('e1', { title: 'Consensus' }));
  const optedIn: RecordingSettings = { ...settings, chatCapture: { claude: true }, redditThreads: true };
  const on = await setup(db, { settings: optedIn });
  expect(await ask(on.deps, 'How does raft elect a leader?')).toMatchObject({ status: 'answered',
    citations: [{ kind: 'expedition', id: 'e1', title: 'Consensus', href: '/expedition.html?id=e1' }] });
  expect(await ask(on.deps, 'Which index do commenters prefer for read-heavy workloads?')).toMatchObject({ status: 'answered',
    citations: [{ kind: 'page', id: thread }] });
  on.set({ ...optedIn, chatCapture: { claude: false } });
  on.model.calls.length = 0;
  expect(await ask(on.deps, 'How does raft elect a leader?')).toEqual(nothing);
  on.set({ ...optedIn, redditThreads: false });
  expect(await ask(on.deps, 'Which index do commenters prefer for read-heavy workloads?')).toEqual(nothing);
  expect(on.model.calls).toHaveLength(0);
}));

test('a concept is sent only when every piece of its evidence may be', () => withDb(async (db) => {
  await seed(db);
  await db.concepts.add({ id: 'c1', name: 'Tombstone', aliases: [], kind: 'concept', gloss: 'A marker recording that an item was deleted.', embedding: null, exposure: 1, firstSeen: 1 });
  await db.conceptEvidence.add({ id: 'ev1', conceptId: 'c1', visitId: 'crdt', canonicalUrl: CRDT, sourceUrl: CRDT, sourceVisitId: 'crdt', startedAt: 1, embedding: null,
    name: 'Tombstone', gloss: 'A marker recording that an item was deleted.', kind: 'concept', role: 'central', salience: 'central' } as never);
  await db.visits.update('crdt', { engagement: 'read' });
  const { model, deps, set } = await setup(db, { model: fakeModel(({ input }) => ({ answerable: true, answer: 'A deletion marker.', sources: input.passages.map(({ ref }) => ref) })) });
  await ask(deps, 'What is a tombstone?');
  expect(model.calls[0]!.input.passages.map(({ kind }) => kind)).toContain('concept');
  set({ ...settings, skippedHosts: ['learn.test'] });
  model.calls.length = 0;
  expect(await ask(deps, 'What is a tombstone?')).toEqual(nothing);
  expect(model.calls).toHaveLength(0);
}));

test('a question that is empty or too long is refused before anything happens', () => withDb(async (db) => {
  const { model, deps } = await setup(db);
  expect(await ask(deps, '   ')).toMatchObject({ status: 'error', code: 'invalid_question' });
  expect(await ask(deps, 'x'.repeat(301))).toMatchObject({ status: 'error', code: 'invalid_question' });
  expect(model.calls).toHaveLength(0);
}));

test('Forget removes the Sent-to-model rows of Ask calls that used a forgotten page or expedition', () => withDb(async (db) => {
  const row = (id: string, extra: object) => ({ id, at: 1, task: 'ask', provider: 'x', model: 'm', instructions: 'i', input: [{ role: 'user' as const, content: 'q' }], outcome: 'succeeded' as const, ...extra });
  await db.expeditions.bulkAdd([expedition('gone'), expedition('kept')]);
  await db.sentToModel.bulkAdd([row('mine', { expeditionIds: ['kept', 'gone'] }), row('other', { expeditionIds: ['kept'] }), row('page', { canonicalUrls: [CRDT] })]);
  const corrections = createCorrections({ db, now: () => 10, newId: () => crypto.randomUUID() });
  await corrections.forgetExpedition('gone');
  await corrections.forgetPage(CRDT);
  expect((await db.sentToModel.filter(({ task }) => task === 'ask').toArray()).map(({ id }) => id)).toEqual(['other']);
}));
