import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Page, Visit } from '@trailmap/shared';
import { chatConversationUrl } from '../capture/chat-sites';
import { openTrailmapDb } from '../db/db';
import { createCorrections } from './corrections';
import { forgetCascade } from './forget';

let db: ReturnType<typeof openTrailmapDb>;
let ids: number;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); ids = 0; });
afterEach(() => db.delete());
const forget = (input: Partial<Parameters<typeof forgetCascade>[1]> & Pick<Parameters<typeof forgetCascade>[1], 'kind'>) =>
  forgetCascade(db, { now: () => 5_000, newId: () => `id-${++ids}`, quiet: true, ...input });

const SECRET = 'private-chat-question-zebra';
const url = chatConversationUrl('chatgpt', 'c1');
const claudeUrl = chatConversationUrl('claude', 'c2');

async function seedConversation(canonicalUrl: string, id: string) {
  const visit: Visit = {
    id, url: canonicalUrl, canonicalUrl, title: 'ChatGPT · AI-generated', tabId: 1, parentVisitId: null, transition: 'typed',
    startedAt: 100, activeMs: 0, scrollDepth: 0, engagement: 'skimmed', expeditionId: null, aiConversation: true,
  };
  const page: Page = {
    canonicalUrl, text: `User question: ${SECRET}`, textHash: 'h', summary: SECRET, takeaways: [SECRET], embedding: null,
    pageKind: 'article', enrichedAt: 1, sourceUrl: canonicalUrl, sourceVisitId: id,
    aiTurns: [{ id: 't1', question: SECRET, answer: `${SECRET} answer`, citations: [] }],
  };
  await db.visits.put(visit);
  await db.pages.put(page);
  await db.jobs.put({ id: `j-${id}`, kind: 'page_enrichment', key: `k-${id}`, priority: 0, createdAt: 1, status: 'pending', availableAt: 1,
    failures: 0, payload: { canonicalUrl, textHash: 'h', visitId: id } });
  await db.sentToModel.put({ id: `m-${id}`, at: 1, task: 'page_enrichment', canonicalUrl, provider: 'p', model: 'm', instructions: 'i',
    input: [{ role: 'user', content: SECRET }] });
}
const everything = async () => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));

test('the startup deny-list purge removes captured chat conversations unless their site is still opted in', async () => {
  await seedConversation(url, 'v1');
  await forget({ kind: 'forget-site', denied: true, chatCapture: { chatgpt: true } });
  expect(await db.visits.count()).toBe(1);
  await forget({ kind: 'forget-site', denied: true, chatCapture: { claude: true } });
  expect(await db.visits.count()).toBe(0);
  expect(await everything()).not.toContain(SECRET);
});

test('with no opt-in information the purge fails closed and removes every captured conversation', async () => {
  await seedConversation(url, 'v1');
  await seedConversation(claudeUrl, 'v2');
  await forget({ kind: 'forget-site', denied: true });
  expect(await db.visits.count()).toBe(0);
  expect(await everything()).not.toContain(SECRET);
});

test('turning one site off removes only that site while the other keeps its conversations', async () => {
  await seedConversation(url, 'v1');
  await seedConversation(claudeUrl, 'v2');
  await forget({ kind: 'forget-site', denied: true, chatCapture: { claude: true } });
  expect((await db.visits.toArray()).map(({ id }) => id)).toEqual(['v2']);
  expect((await db.pages.toArray()).map(({ canonicalUrl }) => canonicalUrl)).toEqual([claudeUrl]);
});

test('Forget removes the conversation transcript, its jobs and the Sent-to-model rows from every table', async () => {
  await seedConversation(url, 'v1');
  await createCorrections({ db, now: () => 5_000, newId: () => `id-${++ids}` }).forgetPage(url);
  expect(await everything()).not.toContain(SECRET);
  expect(await db.pages.count()).toBe(0);
});

test('forgetting the site removes captured conversations on that host', async () => {
  await seedConversation(url, 'v1');
  await createCorrections({ db, now: () => 5_000, newId: () => `id-${++ids}` }).forgetSite('chatgpt.com');
  expect(await everything()).not.toContain(SECRET);
});
