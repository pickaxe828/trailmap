import { join } from 'node:path';
import type { Expedition, Page, Thread, Visit } from '../packages/shared/src/domain';
import { expect, seedCapture } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true });

const day = 86_400_000;
const start = Date.now() - 3 * day;
const RAW = 'raw page text that must never reach the digest';

const url = (id: string) => `https://learn.test/${id}`;
const visit = (id: string, expeditionId: string, at: number): Visit => ({
  id, title: `Page ${id}`, expeditionId, startedAt: at, url: url(id), canonicalUrl: url(id), tabId: 1, parentVisitId: null, transition: 'typed',
  activeMs: 80_000, scrollDepth: 1, engagement: 'read',
});
const page = (id: string): Page => ({ canonicalUrl: url(id), sourceUrl: url(id), sourceVisitId: id, text: RAW, textHash: id, summary: null, takeaways: [],
  embedding: null, pageKind: null, enrichedAt: null });
const expedition = (id: string, title: string, at: number): Expedition => ({
  id, rootVisitId: id, title, startedAt: at, endedAt: at + 60_000, drivingQuestion: `What is ${title}?`, kind: 'learning', userEdited: false, threadId: 'thread',
  fieldNotes: `## What you found\n\nField notes about ${title}.\n\n## Loose ends\n\n- Read the proof behind ${title}\n`,
  notesSource: { visitIds: [id], canonicalUrls: [url(id)] }, notesWrittenAt: at + 60_000, wrappedUpAt: at + 60_000,
});
const thread: Thread = { id: 'thread', title: 'Replication', question: null, status: 'dormant', lastActiveAt: start + day, livingNote: 'Replicas agree through tombstones.',
  notedExpeditionIds: ['deletes', 'gossip'], centroid: null, conceptIds: [] };

test('the Journal writes a weekly digest from field notes only, lists it with links, and Forget removes it', async ({
  context, openExtensionPage, readCapture, mockOrigin,
}, info) => {
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const setup = await openExtensionPage('sidepanel.html');
  await seedCapture(setup, {
    expeditions: [expedition('deletes', 'Replicated deletes', start), expedition('gossip', 'Gossip protocols', start + day)],
    visits: [visit('deletes', 'deletes', start), visit('gossip', 'gossip', start + day)],
    pages: [page('deletes'), page('gossip')], threads: [thread],
  });
  const proof = (name: string) => join(process.env.PROOF_DIR ?? info.outputPath('.'), name);
  const digestCalls = async () => ((await (await fetch(mockOrigin + '/test/calls')).json()) as { text?: { format: { name: string } }; input?: { content?: string }[] }[])
    .filter((call) => call.text?.format.name === 'weekly_digest');

  const journal = await openExtensionPage('journal.html');
  await journal.setViewportSize({ width: 1280, height: 1000 });
  await expect(journal.getByText('Your first digest appears on Monday, or generate one now.')).toBeVisible();
  await journal.getByRole('button', { name: "Generate this week's digest" }).click();
  const digest = journal.getByRole('article');
  await expect(digest.getByText('You spent the week on how replicas agree on deletes.')).toBeVisible();

  // One model call, with the notes and no page text; the made-up ref was dropped.
  const [call, ...rest] = await digestCalls();
  expect(rest).toHaveLength(0);
  const sent = call!.input![0]!.content!;
  expect(sent).toContain('Field notes about Replicated deletes.');
  expect(sent).toContain('Replicas agree through tombstones.');
  expect(sent).not.toContain(RAW);
  await expect(digest.getByRole('link', { name: 'Replicated deletes' }).first()).toBeVisible();
  await expect(digest.getByRole('link', { name: 'Gossip protocols' }).first()).toBeVisible();
  await expect(digest.getByRole('link', { name: 'Replication', exact: true }).first()).toBeVisible();
  await expect(digest.getByText('Read the proof behind Gossip protocols')).toBeVisible();
  await expect(digest.getByText('Never sent.')).toHaveCount(0);
  const logged = (await readCapture('sentToModel')).filter(({ task }) => task === 'weekly_digest');
  expect(logged).toHaveLength(1);
  expect(logged[0]!.expeditionIds).toEqual(['deletes', 'gossip']);

  for (const scheme of ['light', 'dark'] as const) {
    await journal.emulateMedia({ colorScheme: scheme });
    await journal.screenshot({ path: proof(`digest-${scheme}.png`) });
  }

  // Forgetting a source Expedition removes the digest, and nothing is written again on its own.
  await setup.evaluate(() => chrome.runtime.sendMessage({ type: 'trailmap.correction', action: 'forget-expedition', expeditionId: 'deletes' }));
  await expect.poll(async () => (await readCapture('expeditions')).some(({ id }) => id === 'deletes')).toBe(false);
  await expect(journal.getByText('Your first digest appears on Monday, or generate one now.')).toBeVisible();
  expect(await digestCalls()).toHaveLength(1);
});
