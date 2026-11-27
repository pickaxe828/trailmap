import { join } from 'node:path';
import { DB_NAME } from '../packages/extension/src/db/db';
import { expect } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

const ARTICLE = '/content/article.html';

test('queued Page notes survive a worker restart, filter at dispatch, and log every OpenAI attempt', async ({
  context, extensionId, openExtensionPage, fixtureUrl, readCapture, installCompanion, mockOrigin,
}, testInfo) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 820 });
  await expect(panel.getByText('Companion not connected')).toBeVisible();
  const read = async (host: string) => {
    const page = await context.newPage();
    await page.goto(fixtureUrl(host, ARTICLE));
    await expect.poll(async () => (await readCapture('pages')).find(({ canonicalUrl }) => new URL(canonicalUrl).hostname === host)?.text.length).toBeGreaterThan(0);
    await page.locator('#highlight').selectText();
    await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === page.url())?.engagement).toBe('read');
    return page;
  };
  const skipped = await read('skipped.test');
  const recordSite = panel.getByRole('switch', { name: 'Record skipped.test' });
  await expect(recordSite).toBeChecked();
  await recordSite.evaluate((input: HTMLInputElement) => input.click());
  await expect(recordSite).not.toBeChecked();
  await skipped.close();

  await (await read('learn.test')).close();
  const bounced = await context.newPage();
  await bounced.goto(fixtureUrl('bounced.test', ARTICLE));
  await expect.poll(async () => (await readCapture('pages')).some(({ canonicalUrl }) => new URL(canonicalUrl).hostname === 'bounced.test')).toBe(true);
  await bounced.close();

  const cdp = await context.newCDPSession(panel);
  const running = new Set<string>();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const { versionId, runningStatus, scriptURL } of versions) {
      if (!scriptURL.startsWith(`chrome-extension://${extensionId}/`)) continue;
      if (runningStatus === 'running') running.add(versionId);
      else running.delete(versionId);
    }
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => running.size).toBe(1);
  await cdp.send('ServiceWorker.stopWorker', { versionId: [...running][0]! });
  await expect.poll(() => running.size).toBe(0);

  installCompanion();
  await panel.reload();
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  await expect(panel.getByText('Tombstones retain deletion history across replicas.')).toBeVisible();
  await expect(panel.getByText('A tombstone records that an item was deleted.')).toBeVisible();
  await expect(panel.getByText('Replicas can process updates out of order.')).toBeVisible();
  await panel.getByText('Tombstones retain deletion history across replicas.').scrollIntoViewIfNeeded();
  await panel.screenshot({ path: testInfo.outputPath('page-enrichment.png') });
  const pages = await readCapture('pages');
  expect(pages.find(({ canonicalUrl }) => new URL(canonicalUrl).hostname === 'learn.test')).toMatchObject({
    pageKind: 'article', answersQuestion: 'How do replicated lists represent deletes?',
    conceptMentions: [{ name: 'Tombstone', kind: 'concept', gloss: 'A deletion marker.', role: 'explains' }],
    relationMentions: [{ from: 'Tombstone', to: 'CRDT', type: 'part_of' }],
  });

  await expect.poll(async () => (await readCapture('concepts')).map(({ name, exposure }) => ({ name, exposure })))
    .toEqual([{ name: 'Tombstone', exposure: 1 }]);
  const [concept] = await readCapture('concepts');
  const evidenceVisit = (await readCapture('visits')).find(({ url }) => new URL(url).hostname === 'learn.test');
  await expect.poll(() => readCapture('edges')).toMatchObject([
    { from: evidenceVisit?.id, to: concept?.id, type: 'teaches', evidence: [evidenceVisit?.id], weight: 1 },
  ]);

  const settingsTab = context.waitForEvent('page');
  await panel.getByRole('link', { name: 'See what was sent' }).click();
  const settings = await settingsTab;
  const log = settings.getByRole('region', { name: 'Sent-to-model log' });
  const attempts = await (await fetch(mockOrigin + '/test/calls')).json() as {
    instructions: string; input: { role: string; content: string }[];
  }[];
  expect(attempts).toHaveLength(3);
  for (const attempt of attempts) {
    expect(JSON.parse(attempt.input[0]!.content).url).toBe(fixtureUrl('learn.test', '/replicated-lists?chapter=2'));
  }
  const entries = log.getByRole('button', { name: /ChatGPT plan/ });
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText('Succeeded');
  await expect(entries.nth(1)).toContainText('Failed: invalid_output');
  await expect(entries.nth(2)).toContainText('Failed: provider_rejected');
  const visibleParagraph = (text: string) => log.getByRole('paragraph').and(log.getByText(text, { exact: true }));
  await entries.nth(1).click();
  await expect(visibleParagraph('This fixture reply needs repair.')).toBeVisible();
  await entries.first().click();
  await expect(visibleParagraph(attempts[2]!.instructions)).toBeVisible();
  await expect(visibleParagraph(attempts[2]!.input[1]!.content)).toBeVisible();
  await entries.first().click();
  await log.screenshot({ path: testInfo.outputPath('sent-to-model.png') });
});

test('a plan usage limit pauses ChatGPT notes but not capture; a successful probe clears the banner', async ({
  context, openExtensionPage, fixtureUrl, readCapture, installCompanion, mockOrigin,
}, testInfo) => {
  installCompanion();
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 660 });
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const page = await context.newPage();
  await page.goto(fixtureUrl('limit.test', ARTICLE));
  await expect.poll(async () => (await readCapture('pages')).length).toBe(1);
  await page.locator('#highlight').selectText();
  const banner = panel.getByText('ChatGPT plan limit reached');
  await expect(banner).toBeVisible({ timeout: 40_000 });
  await expect(panel.getByText('AI notes using ChatGPT are paused until your limit resets. Browsing is still recorded.')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'ChatGPT usage settings' })).toBeVisible();
  await panel.screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'ai-notes-paused.png') : testInfo.outputPath('ai-notes-paused.png') });
  const next = fixtureUrl('learn.test', '/trail/start.html');
  await page.goto(next);
  await expect.poll(async () => (await readCapture('visits')).some(({ url }) => url === next)).toBe(true);

  expect((await fetch(mockOrigin + '/test/clear-plan-error', { method: 'POST' })).status).toBe(204);
  // Make the real retry due without a 30-minute wait. Only the queue can clear the hold.
  await panel.evaluate(async (dbName) => {
    const request = indexedDB.open(dbName);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('queueHolds', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore('queueHolds');
        const read = store.get('ai');
        read.onsuccess = () => store.put({ ...read.result, retryAt: 0 });
      });
    } finally {
      db.close();
    }
    await chrome.alarms.create('trailmap.jobs', { when: Date.now() + 1000 });
  }, DB_NAME);
  await expect(panel.getByText('Tombstones retain deletion history across replicas.')).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test('an ineligible ChatGPT account is offered other providers until an eligible sign-in', async ({
  context, openExtensionPage, fixtureUrl, readCapture, installCompanion, mockOrigin,
}, info) => {
  installCompanion();
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 660 });
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const page = await context.newPage();
  await page.goto(fixtureUrl('ineligible.test', ARTICLE));
  await expect.poll(async () => (await readCapture('pages')).length).toBe(1);
  await page.locator('#highlight').selectText();
  const banner = panel.getByText('ChatGPT account not eligible');
  await expect(banner).toBeVisible({ timeout: 40_000 });
  await expect(panel.getByText(/Anthropic API key or.*Ollama/)).toBeVisible();
  await panel.screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'not-eligible.png') : info.outputPath('not-eligible.png') });
  const providerTab = context.waitForEvent('page');
  await expect(panel.getByRole('link', { name: 'Choose another provider' })).toHaveAttribute('data-variant', 'secondary');
  await panel.getByRole('link', { name: 'Choose another provider' }).click();
  const settings = await providerTab;
  await expect(settings).toHaveURL(/\/settings\.html#model-providers$/);
  await expect(settings.getByRole('heading', { name: 'Model providers' })).toBeVisible();

  expect((await fetch(mockOrigin + '/test/clear-plan-error', { method: 'POST' })).status).toBe(204);
  await settings.getByRole('button', { name: 'Sign out' }).click();
  await signInToMockChatGpt(context, settings);
  await expect(panel.getByText('Tombstones retain deletion history across replicas.')).toBeVisible();
  await expect(banner).toHaveCount(0);
});
