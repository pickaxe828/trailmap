import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Page, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { forgetCascade } from './forget';

let db: ReturnType<typeof openTrailmapDb>;
let ids: number;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); ids = 0; });
afterEach(() => db.delete());
const forget = (input: Partial<Parameters<typeof forgetCascade>[1]> & Pick<Parameters<typeof forgetCascade>[1], 'kind'>) =>
  forgetCascade(db, { now: () => 5_000, newId: () => `id-${++ids}`, quiet: true, ...input });

const SECRET = 'private-thread-comment-zebra';
const THREAD = 'https://www.reddit.com/r/databases/comments/abc123/why_compaction/';
const FEED = 'https://www.reddit.com/r/databases/';

async function seed(canonicalUrl: string, id: string) {
  const visit: Visit = {
    id, url: canonicalUrl, canonicalUrl, title: 'A thread', tabId: 1, parentVisitId: null, transition: 'link',
    startedAt: 100, activeMs: 0, scrollDepth: 0, engagement: 'read', expeditionId: null,
  };
  const page: Page = {
    canonicalUrl, text: `A comment: ${SECRET}`, textHash: 'h', summary: SECRET, takeaways: [SECRET], embedding: null,
    pageKind: 'forum', enrichedAt: 1, sourceUrl: canonicalUrl, sourceVisitId: id,
  };
  await db.visits.put(visit);
  await db.pages.put(page);
  await db.jobs.put({ id: `j-${id}`, kind: 'page_enrichment', key: `k-${id}`, priority: 0, createdAt: 1, status: 'pending', availableAt: 1,
    failures: 0, payload: { canonicalUrl, textHash: 'h', visitId: id } });
  await db.sentToModel.put({ id: `m-${id}`, at: 1, task: 'page_enrichment', canonicalUrl, provider: 'p', model: 'm', instructions: 'i',
    input: [{ role: 'user', content: SECRET }] });
}
const everything = async () => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));

test('turning the Reddit opt-in off removes every captured thread, its Page, jobs and Sent-to-model rows', async () => {
  await seed(THREAD, 'v1');
  await forget({ kind: 'forget-site', denied: true, redditThreads: true });
  expect(await db.visits.count()).toBe(1);
  await forget({ kind: 'forget-site', denied: true, redditThreads: false });
  expect(await db.visits.count()).toBe(0);
  expect(await db.pages.count()).toBe(0);
  expect(await everything()).not.toContain(SECRET);
});

test('with no opt-in information the startup purge fails closed and removes captured threads', async () => {
  await seed(THREAD, 'v1');
  await forget({ kind: 'forget-site', denied: true });
  expect(await db.visits.count()).toBe(0);
  expect(await everything()).not.toContain(SECRET);
});

test('while opted in the purge keeps threads but still removes a Reddit feed that was somehow stored', async () => {
  await seed(THREAD, 'v1');
  await seed(FEED, 'v2');
  await forget({ kind: 'forget-site', denied: true, redditThreads: true });
  expect((await db.visits.toArray()).map(({ id }) => id)).toEqual(['v1']);
});

test('forgetting a thread Visit removes its text from every table', async () => {
  await seed(THREAD, 'v1');
  await forget({ kind: 'forget-page', visitIds: ['v1'] });
  expect(await everything()).not.toContain(SECRET);
});
