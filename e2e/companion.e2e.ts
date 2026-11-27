/**
 * The real companion binary, launched by Chromium through Native Messaging.
 * Pattern for every E2E that needs the companion: see notes-05.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';

// Only exists inside the extension's service worker, where `worker.evaluate` runs.
declare const chrome: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } };

const STATUS_KEY = 'trailmap.companionStatus';


test.describe('with the companion installed', () => {
  test.use({ companionInstalled: true });

  test('the side panel says Companion connected after the hello handshake', async ({ serviceWorker, openExtensionPage }) => {
    const page = await openExtensionPage('sidepanel.html');
    await expect(page.getByText('Companion connected')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Companion not connected')).toHaveCount(0);
    const worker = await serviceWorker();
    expect(await worker.evaluate((key) => chrome.storage.session.get(key).then((v) => v[key]), STATUS_KEY)).toEqual({ state: 'connected', version: '0.0.0' });
  });

  test('the browser launched the real binary with the test environment (it logged to the test data dir)', async ({
    openExtensionPage,
    companionDataDir,
  }) => {
    const page = await openExtensionPage('sidepanel.html');
    await expect(page.getByText('Companion connected')).toBeVisible({ timeout: 15_000 });
    expect(readFileSync(join(companionDataDir, 'companion.log'), 'utf8')).toContain('host started');
  });
});

test.describe('without the companion', () => {
  test('the side panel says Companion not connected and links to setup instructions; recording is unaffected', async ({
    context,
    openExtensionPage,
  }, info) => {
    const page = await openExtensionPage('sidepanel.html');
    await page.setViewportSize({ width: 400, height: 660 });
    await expect(page.getByText('Companion not connected')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Recording is on')).toBeVisible();

    await page.screenshot({ path: process.env.PROOF_DIR
      ? join(process.env.PROOF_DIR, 'companion-missing.png') : info.outputPath('companion-missing.png') });
    const setup = context.waitForEvent('page');
    await expect(page.getByRole('link', { name: 'Fix connection' })).toHaveAttribute('data-variant', 'secondary');
    await page.getByRole('link', { name: 'Fix connection' }).click();
    const instructions = await setup;
    await expect(instructions.getByRole('heading', { name: 'Set up the companion' })).toBeVisible();
    expect(instructions.url()).toMatch(/\/settings\.html#companion$/);
  });

  test('the status goes live when the companion appears later, without reloading anything', async ({
    openExtensionPage,
    installCompanion,
  }) => {
    const page = await openExtensionPage('sidepanel.html');
    await expect(page.getByText('Companion not connected')).toBeVisible({ timeout: 15_000 });

    installCompanion();

    await expect(page.getByText('Companion connected')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('Companion not connected')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Fix connection' })).toHaveCount(0);
  });
});
