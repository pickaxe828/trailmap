import { expect } from './fixtures';
import { test } from './model-fixtures';

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
  const callback = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await expect((await callback).getByText('Signed in. You can close this tab.')).toBeVisible();
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
  await panel.getByRole('link', { name: 'Sent-to-model log' }).click();
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
  await entries.first().click();
  await expect(log.getByText(attempts[2]!.instructions, { exact: true })).toBeVisible();
  await expect(log.getByText(attempts[2]!.input[1]!.content, { exact: true })).toBeVisible();
  await entries.first().click();
  await log.screenshot({ path: testInfo.outputPath('sent-to-model.png') });
});

test('a usage limit shows why automatic Page notes paused but capture continues', async ({
  context, openExtensionPage, fixtureUrl, readCapture, installCompanion,
}, testInfo) => {
  installCompanion();
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 660 });
  const callback = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await expect((await callback).getByText('Signed in. You can close this tab.')).toBeVisible();
  const page = await context.newPage();
  await page.goto(fixtureUrl('limit.test', ARTICLE));
  await expect.poll(async () => (await readCapture('pages')).length).toBe(1);
  await page.locator('#highlight').selectText();
  const banner = panel.getByText('AI notes paused until your limit resets. Browsing is still recorded.');
  await expect(banner).toBeVisible({ timeout: 40_000 });
  await expect(panel.getByRole('link', { name: 'ChatGPT usage settings' })).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('ai-notes-paused.png') });
  const next = fixtureUrl('learn.test', '/trail/start.html');
  await page.goto(next);
  await expect.poll(async () => (await readCapture('visits')).some(({ url }) => url === next)).toBe(true);
});
