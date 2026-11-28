import { expect, test } from 'bun:test';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { DIGEST_ALARM, requestRecentDigest, runScheduledDigest, startDigestSchedule, type DigestLedger } from './schedule';

const at = (iso: string) => Date.parse(iso);
const ledger = (initial?: string) => {
  const state = { key: initial };
  const store: DigestLedger = { read: async () => state.key, write: async (key) => { state.key = key; } };
  return { state, store };
};
async function withDb<T>(run: (db: TrailmapDb) => Promise<T>) {
  const db = openTrailmapDb(crypto.randomUUID());
  try { return await run(db); } finally { await db.delete(); }
}
async function until<T>(read: () => Promise<T>, expected: T) {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (JSON.stringify(value) === JSON.stringify(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(await read() as unknown).toEqual(expected);
}
const digestJobs = (db: TrailmapDb) => db.jobs.filter(({ kind }) => kind === 'weekly_digest').toArray();

test('Monday queues last week once; the same Monday again, or later in the week, queues nothing', () => withDb(async (db) => {
  const { store, state } = ledger();
  let now = at('2026-11-23T00:30:00Z');
  const clock = { now: () => now, zone: () => 'UTC' };
  expect((await runScheduledDigest(db, store, clock))?.key).toBe('week-2026-11-16');
  expect(await runScheduledDigest(db, store, clock)).toBeUndefined();
  now = at('2026-11-26T10:00:00Z');
  expect(await runScheduledDigest(db, store, clock)).toBeUndefined();
  expect(state.key).toBe('week-2026-11-16');
  const [job] = await digestJobs(db);
  expect(await digestJobs(db)).toHaveLength(1);
  expect(job!.payload).toEqual({ id: 'week-2026-11-16', kind: 'week', from: at('2026-11-16T00:00:00Z'), to: at('2026-11-23T00:00:00Z') });
}));

test('a Monday missed while the browser was closed is caught up at the next startup, with the latest week only', () => withDb(async (db) => {
  const { store } = ledger('week-2026-11-02');
  const clock = { now: () => at('2026-11-25T08:00:00Z'), zone: () => 'UTC' };
  await runScheduledDigest(db, store, clock);
  expect((await digestJobs(db)).map(({ key }) => key)).toEqual(['week-2026-11-16']);
}));

test('a lost ledger still cannot queue the same week twice: the job key is the week', () => withDb(async (db) => {
  const clock = { now: () => at('2026-11-25T08:00:00Z'), zone: () => 'UTC' };
  await runScheduledDigest(db, ledger().store, clock);
  await runScheduledDigest(db, ledger().store, clock);
  expect(await digestJobs(db)).toHaveLength(1);
}));

test('the week boundary is local: Tokyo is on Monday while Los Angeles is still on Sunday', () => withDb(async (db) => {
  const instant = at('2026-11-22T15:30:00Z');
  expect((await runScheduledDigest(db, ledger().store, { now: () => instant, zone: () => 'Asia/Tokyo' }))?.key).toBe('week-2026-11-16');
  expect((await runScheduledDigest(db, ledger('week-2026-11-09').store, { now: () => instant, zone: () => 'America/Los_Angeles' }))).toBeUndefined();
}));

test('startup checks once, then every alarm tick checks again, through the alarms seam', () => withDb(async (db) => {
  const { store } = ledger();
  let now = at('2026-11-22T10:00:00Z'); // Sunday: the week before last is due, not the one that ends tonight.
  const listeners: ((alarm: { name: string }) => void)[] = [];
  const created: string[] = [];
  startDigestSchedule(db, Promise.resolve(), store, { now: () => now, zone: () => 'UTC' },
    { create: (name) => created.push(name), onAlarm: { addListener: (listener) => listeners.push(listener) } });
  await until(async () => (await digestJobs(db)).map(({ key }) => key), ['week-2026-11-09']);
  expect(created).toEqual([DIGEST_ALARM]);
  now = at('2026-11-23T00:05:00Z'); // The alarm fires after Monday begins.
  listeners[0]!({ name: 'something-else' });
  listeners[0]!({ name: DIGEST_ALARM });
  await until(async () => (await digestJobs(db)).map(({ key }) => key).sort(), ['week-2026-11-09', 'week-2026-11-16']);
}));

test('on demand: nothing eligible means no job; with notes it queues the last 7 days under a per-day id', () => withDb(async (db) => {
  const now = at('2026-11-28T12:00:00Z');
  const clock = { now: () => now, zone: () => 'UTC' };
  const settings = () => ({ paused: false, skippedHosts: [] });
  expect(await requestRecentDigest(db, settings, clock)).toEqual({ status: 'nothing' });
  expect(await requestRecentDigest(db, () => ({ paused: true, skippedHosts: [] }), clock)).toEqual({ status: 'paused' });
  expect(await digestJobs(db)).toHaveLength(0);
  await db.visits.add({ id: 'v', tabId: 1, url: 'https://learn.test/v', canonicalUrl: 'https://learn.test/v', title: 't', parentVisitId: null, transition: 'link',
    startedAt: now - 86_400_000, activeMs: 70_000, scrollDepth: 1, engagement: 'read', expeditionId: 'e' });
  await db.expeditions.add({ id: 'e', title: 'T', drivingQuestion: null, kind: 'learning', startedAt: now - 2 * 86_400_000, endedAt: now - 86_400_000, fieldNotes: 'Notes',
    userEdited: false, threadId: null, notesSource: { visitIds: ['v'], canonicalUrls: ['https://learn.test/v'] } });
  expect(await requestRecentDigest(db, settings, clock)).toEqual({ status: 'queued' });
  const [job] = await digestJobs(db);
  expect(job!.payload).toEqual({ id: 'recent-2026-11-28', kind: 'recent', from: now - 7 * 86_400_000, to: now });
}));
