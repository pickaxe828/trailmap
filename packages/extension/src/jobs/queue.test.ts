import { afterEach, beforeEach, expect, test } from 'bun:test';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { CompanionRequestError } from '../companion/client';
import { enqueueJob, JobQueue, JOB_LEASE_MS, JOB_PRIORITY, type JobPriority } from './queue';
import { discardJobs } from './testing';

let db: TrailmapDb;
let now: number;
beforeEach(() => {
  db = openTrailmapDb(crypto.randomUUID());
  now = 1_000_000;
});
afterEach(async () => { await db.delete(); });

const enqueue = (id: string, priority: JobPriority = JOB_PRIORITY.readPage) =>
  enqueueJob(db, { kind: 'page_enrichment', key: id, priority, payload: { canonicalUrl: id, textHash: 'hash', visitId: 'visit' } }, now);

function worker(run: (url: string) => Promise<void>) {
  return new JobQueue(db, () => now, { ...discardJobs, page_enrichment: ({ payload }) => run(payload.canonicalUrl) });
}

test('a restarted worker claims jobs in budget order, promotes a skimmed Page, and deduplicates completed keys', async () => {
  await enqueue('merge', JOB_PRIORITY.mergeVerdict);
  await enqueue('skimmed', JOB_PRIORITY.skimmedPage);
  await enqueue('promoted', JOB_PRIORITY.skimmedPage);
  await enqueue('notes', JOB_PRIORITY.fieldNotes);
  await enqueue('promoted');
  await enqueue('read');
  db.close();
  db = openTrailmapDb(db.name);
  const ran: string[] = [];
  const queue = worker(async (id) => { ran.push(id); });
  while (await queue.runNext()) { /* drain */ }
  await enqueue('read');
  expect(await queue.runNext()).toBe(false);
  expect(ran).toEqual(['promoted', 'read', 'notes', 'skimmed', 'merge']);
});

test('a replacement worker respects the lease and a late completion cannot commit after reclaim', async () => {
  await enqueue('page');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const commits: string[] = [];
  const original = new JobQueue(db, () => now, { ...discardJobs, page_enrichment: async () => {
    entered.resolve();
    await release.promise;
    return { commit: async () => { commits.push('stale'); } };
  } });
  const interrupted = original.runNext();
  await entered.promise;
  const replacement = worker(async () => { commits.push('fresh'); });
  expect(await original.runNext()).toBe(false);
  expect(await replacement.runNext()).toBe(false);
  now += JOB_LEASE_MS;
  expect(await replacement.runNext()).toBe(true);
  release.resolve();
  await interrupted;
  expect(commits).toEqual(['fresh']);
});

test('a usage limit holds the whole queue across restarts and probes later without assuming a reset time', async () => {
  await enqueue('page');
  const limit = worker(async () => { throw new CompanionRequestError('usage_limit_exceeded', 'limit'); });
  await limit.runNext();
  await enqueue('higher priority too', JOB_PRIORITY.fieldNotes);
  const ran: string[] = [];
  const resumed = worker(async (id) => { ran.push(id); });
  expect(await resumed.runNext()).toBe(false);
  now += 30 * 60_000;
  while (await resumed.runNext()) { /* drain */ }
  expect(ran).toEqual(['page', 'higher priority too']);
});

test('ineligibility stops the queue until the user successfully signs in again', async () => {
  await enqueue('page');
  const queue = worker(async () => { throw new CompanionRequestError('not_eligible', 'ineligible'); });
  await queue.runNext();
  now += 7 * 24 * 60 * 60_000;
  const resumed = worker(async () => {});
  expect(await resumed.runNext()).toBe(false);
  await resumed.accountChanged();
  expect(await resumed.runNext()).toBe(false);
  await resumed.accountChanged(true);
  expect(await resumed.runNext()).toBe(true);
});

test('a temporary error uses the retry hint and lets the next ready job run', async () => {
  await enqueue('unavailable');
  await enqueue('skimmed', JOB_PRIORITY.skimmedPage);
  const failed = worker(async () => { throw new CompanionRequestError('usage_unavailable', 'temporary', { retryAfterMs: 12_000 }); });
  await failed.runNext();
  const ran: string[] = [];
  const resumed = worker(async (id) => { ran.push(id); });
  expect(await resumed.runNext()).toBe(true);
  now += 11_999;
  expect(await resumed.runNext()).toBe(false);
  now++;
  expect(await resumed.runNext()).toBe(true);
  expect(ran).toEqual(['skimmed', 'unavailable']);
});
