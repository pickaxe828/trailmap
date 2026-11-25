import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, test as base } from './fixtures';

const script = fileURLToPath(new URL('./mock-page-summary.ts', import.meta.url));
const test = base.extend<{ mockOrigin: string }>({
  mockOrigin: async ({}, use) => {
    const child = spawn('bun', [script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = once(child, 'exit');
    const lines = createInterface({ input: child.stdout });
    try {
      const [origin] = await Promise.race([
        once(lines, 'line'),
        exited.then(() => { throw new Error('Mock model server exited without an origin'); }),
      ]);
      await use(origin);
    } finally {
      lines.close();
      child.kill();
      await exited;
    }
  },
  companionEnv: async ({ companionEnv, mockOrigin }, use) => {
    await use({ ...companionEnv, TRAILMAP_OPENAI_AUTH_BASE_URL: mockOrigin, TRAILMAP_OPENAI_BASE_URL: mockOrigin + '/v1' });
  },
});

test.use({ companionInstalled: true });

test('summarizes the active Page from captured text in the side panel', async ({
  context, openExtensionPage, fixtureUrl, readCapture,
}, testInfo) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 720 });
  const callback = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await expect((await callback).getByText('Signed in. You can close this tab.')).toBeVisible();
  await expect(panel.getByText('Signed in as reader@example.test · plan usage on')).toBeVisible();

  const article = await context.newPage();
  await article.goto(fixtureUrl('learn.test', '/content/article.html'));
  await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.includes('Tombstones preserve causal history'))).toBe(true);
  // Headless renders sidepanel.html as a tab; keep the article active as it would be next to a real side panel.
  await article.bringToFront();
  await panel.getByRole('button', { name: 'Summarize this page' }).evaluate((button) => (button as HTMLButtonElement).click());
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
