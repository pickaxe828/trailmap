import { expect } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true });

test('summarizes the active Page from captured text in the side panel', async ({
  context, openExtensionPage, fixtureUrl, readCapture,
}, testInfo) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 720 });
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));

  const article = await context.newPage();
  await article.goto(fixtureUrl('learn.test', '/content/article.html'));
  await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.includes('Tombstones preserve causal history'))).toBe(true);
  // Headless renders sidepanel.html as a tab; keep the article active as it would be next to a real side panel.
  await article.bringToFront();
  const summarize = () => panel.getByRole('button', { name: 'Summarize this page' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await summarize();
  await expect(panel.getByText('This page is not eligible for a model summary.')).toBeVisible();

  await article.locator('#short-copy').selectText();
  await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === article.url())?.engagement).toBe('read');
  expect(await readCapture('highlights')).toEqual([]);
  await summarize();
  await expect(panel.getByRole('heading', { name: 'Summary: Deleting items in a replicated list' })).toBeVisible();
  await expect(panel.getByText('Tombstones let replicas learn about deletions even when updates arrive out of order.')).toBeVisible();
  await expect(panel.getByText('A deletion marker preserves causal history.')).toBeVisible();
  await expect(panel.getByText('Each marker refers to a specific item.')).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('page-summary.png') });

  await article.goto(fixtureUrl('learn.test', '/content/article.html?private'));
  await article.bringToFront();
  await panel.getByRole('button', { name: 'Summarize this page' }).evaluate((button) => (button as HTMLButtonElement).click());
  await expect(panel.getByText('No captured text is available for this page yet.')).toBeVisible();
});
