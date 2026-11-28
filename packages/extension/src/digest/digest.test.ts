import { expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import { CompanionRequestError } from '../companion/client';
import { forgetCascade } from '../corrections/forget';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { JobQueue } from '../jobs/queue';
import { discardJobs } from '../jobs/testing';
import type { RecordingSettings } from '../privacy/policy';
import { refreshConcept, type ConceptEvidence } from '../concepts/evidence';
import { newThread } from '../threads/model';
import { resolveDraft, writeDigest } from './handler';
import { digestTables, readDigestInput } from './input';

const DAY = 86_400_000;
const FROM = 1_000 * DAY;
const TO = FROM + 7 * DAY;
const NOW = TO + 3 * 60 * 60_000; // Past the wait for late notes.
const settings: RecordingSettings = { paused: false, skippedHosts: [] };
const RAW_PAGE_TEXT = 'raw-page-text-never-sent';

const visit = (id: string, host: string, expeditionId: string): Visit => ({
  id, tabId: 1, url: `https://${host}/${id}`, canonicalUrl: `https://${host}/${id}`, title: `Title ${id}`, parentVisitId: null, transition: 'link',
  startedAt: FROM, activeMs: 70_000, scrollDepth: 1, engagement: 'read', expeditionId,
});
async function addExpedition(db: TrailmapDb, id: string, extra: Partial<Expedition> = {}, host = 'learn.test') {
  await db.visits.add(visit(`v-${id}`, host, id));
  await db.pages.add({ canonicalUrl: `https://${host}/v-${id}`, sourceUrl: `https://${host}/v-${id}`, sourceVisitId: `v-${id}`, text: RAW_PAGE_TEXT, textHash: id,
    summary: null, takeaways: [], embedding: null, pageKind: null, enrichedAt: null });
  await db.expeditions.add({ id, title: `Trip ${id}`, drivingQuestion: `Question ${id}?`, kind: 'learning', startedAt: FROM + DAY, endedAt: FROM + 2 * DAY,
    fieldNotes: `Field notes for ${id}.\n\n## Loose ends\n\n- Check the proof for ${id}\n`, userEdited: false, threadId: null,
    notesSource: { visitIds: [`v-${id}`], canonicalUrls: [`https://${host}/v-${id}`] }, notesWrittenAt: FROM + 2 * DAY, ...extra });
}

type Sent = { input: Record<string, unknown>; guard: Parameters<NonNullable<Parameters<typeof writeDigest>[2]>['request'] & {}>[2] };
function harness(db: TrailmapDb, reply: (sent: Sent) => unknown, getSettings = () => settings) {
  const calls: Sent[] = [];
  const queue = new JobQueue(db, () => NOW, { ...discardJobs, weekly_digest: writeDigest(db, getSettings, { now: () => NOW, request: async (_db, payload, guard) => {
    if (!await guard.allow()) throw new CompanionRequestError('dispatch_cancelled', 'refused');
    const sent = { input: JSON.parse(payload.input), guard, task: payload.task } as Sent;
    calls.push(sent);
    return { output: reply(sent) };
  } }) }, [...digestTables(db), db.digests]);
  const enqueue = async (id = 'week-1', kind: 'week' | 'recent' = 'week') => {
    await db.jobs.add({ id: `job-${id}`, kind: 'weekly_digest', key: id, priority: 3, createdAt: 1, status: 'pending', availableAt: 1, failures: 0,
      payload: { id, kind, from: FROM, to: TO } });
  };
  return { calls, queue, enqueue };
}
async function withDb<T>(run: (db: TrailmapDb) => Promise<T>) {
  const db = openTrailmapDb(crypto.randomUUID());
  try { return await run(db); } finally { await db.delete(); }
}
async function addConcept(db: TrailmapDb, id: string, name: string, visitId: string, extra: Partial<ConceptEvidence> = {}) {
  const url = `https://${visitId === 'v-skipped' ? 'skip.test' : 'learn.test'}/${visitId}`;
  await db.conceptEvidence.add({ id: `ev-${id}`, conceptId: id, name, kind: 'concept', gloss: `${name} gloss`, role: 'explains', salience: 'central', visitId,
    canonicalUrl: url, startedAt: FROM + DAY, embedding: null, ...extra } as ConceptEvidence);
  await refreshConcept(db, id);
}
const ok = ({ input }: Sent) => ({ summary: 'A week on replicas.', expeditions: [{ ref: 'e1', why: 'It was central.' }], threads: [], concepts: [] });

test('a week of field notes makes one model call that carries field notes and living notes, never page text', () => withDb(async (db) => {
  await db.threads.add({ ...newThread('t1', FROM), title: 'Replication', livingNote: 'Living note on replication.', notedExpeditionIds: ['a', 'b'] });
  await addExpedition(db, 'a', { threadId: 't1', myNotes: 'my own words' });
  await addExpedition(db, 'b', { threadId: 't1', endedAt: FROM + 3 * DAY });
  const { calls, queue, enqueue } = harness(db, ({ input }) => ({ summary: 'You studied replication.',
    expeditions: [{ ref: 'e2', why: 'Closed the loop.' }, { ref: 'e1', why: 'Started it.' }], threads: [{ ref: 't1', why: 'Two sittings.' }], concepts: [] }));
  await enqueue();
  expect(await queue.runNext()).toBe(true);
  expect(calls).toHaveLength(1);
  const sent = JSON.stringify(calls[0]!.input);
  expect(sent).not.toContain(RAW_PAGE_TEXT);
  expect(sent).toContain('Living note on replication.');
  expect(sent).toContain('Field notes for a.');
  expect(sent).toContain('my own words');
  expect(calls[0]!.guard.visitIds).toEqual(['v-a', 'v-b']);
  expect(calls[0]!.guard.expeditionIds).toEqual(['a', 'b']);
  const digest = (await db.digests.get('week-1'))!;
  expect(digest).toMatchObject({ kind: 'week', from: FROM, to: TO, summary: 'You studied replication.',
    expeditions: [{ id: 'a', why: 'Closed the loop.' }, { id: 'b', why: 'Started it.' }], threads: [{ id: 't1', why: 'Two sittings.' }] });
  // Nothing but ids and the model's words is stored: titles and loose ends are read live.
  expect(JSON.stringify(digest)).not.toContain('Trip a');
  expect(JSON.stringify(digest)).not.toContain('Check the proof');
}));

test('My notes are left out of the request when "Use my notes" is off', () => withDb(async (db) => {
  await addExpedition(db, 'a', { myNotes: 'my own words' });
  const input = await readDigestInput(db, { from: FROM, to: TO }, { ...settings, useMyNotes: false });
  expect(input?.input).toContain('Field notes for a.');
  expect(input?.input).not.toContain('my own words');
}));

test('refs the model invents are dropped, and an answer naming nothing usable falls back to the request order', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  await addExpedition(db, 'b', { endedAt: FROM + 3 * DAY });
  const prepared = (await readDigestInput(db, { from: FROM, to: TO }, settings))!;
  expect(prepared.order.expeditions).toEqual(['b', 'a']);
  const resolved = resolveDraft({ summary: ' Week. ', expeditions: [{ ref: 'e2', why: 'x' }, { ref: 'e99', why: 'y' }, { ref: 'e2', why: 'dup' }],
    threads: [{ ref: 't9', why: 'z' }], concepts: ['c1'] }, prepared);
  expect(resolved).toEqual({ summary: 'Week.', expeditions: [{ id: 'a', why: 'x' }], threads: [], conceptIds: [] });
  expect(resolveDraft({ summary: 's', expeditions: [{ ref: 'nope', why: '' }], threads: [], concepts: [] }, prepared).expeditions)
    .toEqual([{ id: 'b', why: '' }, { id: 'a', why: '' }]);
}));

test('a week with no eligible field notes makes no model call and stores no digest', () => withDb(async (db) => {
  await addExpedition(db, 'errand', { kind: 'errand' });
  await addExpedition(db, 'unnoted', { fieldNotes: null });
  await addExpedition(db, 'outside', { endedAt: TO + DAY });
  await addExpedition(db, 'skipped', {}, 'skip.test');
  const { calls, queue, enqueue } = harness(db, ok, () => ({ paused: false, skippedHosts: ['skip.test'] }));
  await enqueue();
  expect(await queue.runNext()).toBe(true);
  expect(calls).toHaveLength(0);
  expect(await db.digests.count()).toBe(0);
  expect(await db.jobs.get('job-week-1')).toBeUndefined(); // Discarded, not retried.
}));

test('an Expedition from a skipped site is never sent, even beside eligible ones', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  await addExpedition(db, 'skipped', {}, 'skip.test');
  const { calls, queue, enqueue } = harness(db, ok, () => ({ paused: false, skippedHosts: ['skip.test'] }));
  await enqueue();
  await queue.runNext();
  expect(JSON.stringify(calls[0]!.input)).not.toContain('Field notes for skipped');
  expect(calls[0]!.guard.visitIds).toEqual(['v-a']);
}));

test('a thread whose members include a skipped site is left out of the request, its eligible Expedition stays in', () => withDb(async (db) => {
  await db.threads.add({ ...newThread('t1', FROM), title: 'Mixed', livingNote: 'Mixed living note.', notedExpeditionIds: ['a', 'skipped'] });
  await addExpedition(db, 'skipped', { threadId: 't1', startedAt: 1, endedAt: 2 }, 'skip.test');
  await addExpedition(db, 'a', { threadId: 't1' });
  const input = (await readDigestInput(db, { from: FROM, to: TO }, { paused: false, skippedHosts: ['skip.test'] }))!;
  expect(input.input).not.toContain('Mixed living note.');
  expect(input.refs.threads.size).toBe(0);
  expect(input.refs.expeditions.size).toBe(1);
}));

test('forgetting a page behind the digest stops the call at the guard: nothing is sent', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  const { calls, queue, enqueue } = harness(db, ok);
  await enqueue();
  // Forget between reading the notes and dispatching: the guard re-reads and refuses.
  await forgetCascade(db, { kind: 'forget-page', visitIds: ['v-a'], now: () => NOW, newId: () => crypto.randomUUID(), quiet: true });
  expect(await queue.runNext()).toBe(true);
  expect(calls).toHaveLength(0);
}));

test('forgetting a source Expedition removes the digest; forgetting an unrelated one keeps it', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  await addExpedition(db, 'b', { endedAt: FROM + 3 * DAY });
  const { queue, enqueue } = harness(db, () => ({ summary: 'SECRET-DIGEST-WORDS', expeditions: [], threads: [], concepts: [] }));
  await enqueue();
  await queue.runNext();
  expect(await db.digests.count()).toBe(1);
  await addExpedition(db, 'unrelated', { endedAt: TO + 5 * DAY }, 'other.test');
  await forgetCascade(db, { kind: 'forget-expedition', visitIds: ['v-unrelated'], expeditionIds: ['unrelated'], now: () => NOW, newId: () => crypto.randomUUID(), quiet: true });
  expect(await db.digests.count()).toBe(1);
  await forgetCascade(db, { kind: 'forget-expedition', visitIds: ['v-a'], expeditionIds: ['a'], now: () => NOW, newId: () => crypto.randomUUID(), quiet: true });
  expect(await db.digests.count()).toBe(0);
  const everything = JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));
  expect(everything).not.toContain('SECRET-DIGEST-WORDS');
  expect(everything).not.toContain('Field notes for a.');
  // It is removed, not queued again: the user can generate the week again on demand.
  expect(await db.jobs.where('status').anyOf('pending', 'leased').filter(({ kind }) => kind === 'weekly_digest').count()).toBe(0);
}));

test('forgetting a site removes digests written from it', () => withDb(async (db) => {
  await addExpedition(db, 'a', {}, 'private.test');
  const { queue, enqueue } = harness(db, ok);
  await enqueue();
  await queue.runNext();
  expect(await db.digests.count()).toBe(1);
  await forgetCascade(db, { kind: 'forget-site', host: 'private.test', now: () => NOW, newId: () => crypto.randomUUID(), quiet: true });
  expect(await db.digests.count()).toBe(0);
}));

test('the notes of an Expedition that is still being written wait, then the digest is made', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  let now = TO + 60_000;
  const calls: unknown[] = [];
  const queue = new JobQueue(db, () => now, { ...discardJobs, weekly_digest: writeDigest(db, () => settings, { now: () => now,
    request: async (_db, payload) => { calls.push(payload.input); return { output: { summary: 'Done.', expeditions: [], threads: [], concepts: [] } }; } }) }, [...digestTables(db), db.digests]);
  await db.jobs.add({ id: 'wrap', kind: 'field_notes', key: 'k', priority: 1, createdAt: 1, status: 'pending', availableAt: now + 10 * DAY, failures: 0,
    payload: { expeditionId: 'a', endedAt: FROM + 2 * DAY, revision: 0 } });
  await db.jobs.add({ id: 'job-w', kind: 'weekly_digest', key: 'w', priority: 3, createdAt: 1, status: 'pending', availableAt: 1, failures: 0, payload: { id: 'week-w', kind: 'week', from: FROM, to: TO } });
  await queue.runNext();
  expect(calls).toHaveLength(0);
  expect((await db.jobs.get('job-w'))?.status).toBe('pending');
  now = TO + 3 * 60 * 60_000; // Waited long enough: write it with what exists.
  await db.jobs.update('job-w', { availableAt: 1 });
  await queue.runNext();
  expect(calls).toHaveLength(1);
}));

test('new concepts of the week are sent by name and strength, and only refs that were sent come back', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  await addConcept(db, 'c-read', 'Tombstone', 'v-a');
  await addConcept(db, 'c-seen', 'Gossip', 'v-a', { salience: 'passing', startedAt: FROM + 2 * DAY });
  await addConcept(db, 'c-old', 'Old news', 'v-a', { startedAt: FROM - DAY });
  const { calls, queue, enqueue } = harness(db, () => ({ summary: 'S', expeditions: [], threads: [], concepts: ['c1', 'c2', 'c7', 'c1'] }));
  await enqueue();
  await queue.runNext();
  const { concepts } = calls[0]!.input as { concepts: { ref: string; name: string; strength: string }[] };
  expect(concepts).toEqual([{ ref: 'c1', name: 'Tombstone', strength: 'studied' }, { ref: 'c2', name: 'Gossip', strength: 'seen' }]);
  expect(JSON.stringify(calls[0]!.input)).not.toContain('gloss');
  expect((await db.digests.get('week-1'))?.conceptIds).toEqual(['c-read', 'c-seen']);
}));

test('a concept with evidence from a skipped site is not sent', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  await addExpedition(db, 'skipped', {}, 'skip.test');
  await addConcept(db, 'c-mixed', 'Mixed', 'v-a');
  await addConcept(db, 'c-mixed', 'Mixed', 'v-skipped', { id: 'ev-2', startedAt: FROM + 3 * DAY });
  const input = (await readDigestInput(db, { from: FROM, to: TO }, { paused: false, skippedHosts: ['skip.test'] }))!;
  expect(input.refs.concepts.size).toBe(0);
  expect(input.input).not.toContain('Mixed');
}));

test('a page forgotten after the notes were read and before dispatch cancels the call', () => withDb(async (db) => {
  await addExpedition(db, 'a');
  await addExpedition(db, 'b', { endedAt: FROM + 3 * DAY });
  const calls: unknown[] = [];
  const queue = new JobQueue(db, () => NOW, { ...discardJobs, weekly_digest: writeDigest(db, () => settings, { now: () => NOW, request: async (_db, _payload, guard) => {
    // The user forgets a page after the request was prepared.
    await forgetCascade(db, { kind: 'forget-page', visitIds: ['v-a'], now: () => NOW, newId: () => crypto.randomUUID(), quiet: true });
    if (!await guard.allow()) throw new CompanionRequestError('dispatch_cancelled', 'refused');
    calls.push(1);
    return { output: { summary: 's', expeditions: [], threads: [], concepts: [] } };
  } }) }, [...digestTables(db), db.digests]);
  await db.jobs.add({ id: 'j', kind: 'weekly_digest', key: 'k', priority: 3, createdAt: 1, status: 'pending', availableAt: 1, failures: 0, payload: { id: 'week-1', kind: 'week', from: FROM, to: TO } });
  await queue.runNext();
  expect(calls).toHaveLength(0);
  expect(await db.digests.count()).toBe(0);
}));
