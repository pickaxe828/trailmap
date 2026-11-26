import { join } from 'node:path';
import { expect, test } from './fixtures';

test('fresh install explains privacy, records without AI, and respects added skip sites', async ({
  context, extensionId, fixtureUrl, readVisits,
}, info) => {
  const onboarding = context.pages().find((page) => page.url() === `chrome-extension://${extensionId}/onboarding.html`)!;
  await expect(onboarding.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  await expect(onboarding.getByText('Recording starts straight away.', { exact: true })).toBeVisible();
  await onboarding.getByText('Default skip list', { exact: true }).click();
  await expect(onboarding.getByText('gmail.com', { exact: true })).toBeVisible();
  await onboarding.getByText('Default skip list', { exact: true }).click();
  await onboarding.getByLabel('Site to skip').fill('https://SKIP.test/example');
  await onboarding.getByRole('button', { name: 'Add site' }).click();
  await expect(onboarding.getByRole('button', { name: 'Remove skip.test from skip list' })).toBeVisible();
  await onboarding.screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'privacy.png') : info.outputPath('privacy.png') });

  const browsing = await context.newPage();
  await browsing.goto(fixtureUrl('sub.skip.test', '/trail/start.html'));
  const skipped = browsing.url();
  await browsing.goto(fixtureUrl('learn.test', '/trail/start.html'));
  await expect.poll(async () => (await readVisits()).map(({ url }) => url)).toContain(browsing.url());
  expect((await readVisits()).map(({ url }) => url)).not.toContain(skipped);
});

test('onboarding detects the companion live and offers optional setup', async ({
  installCompanion, openExtensionPage,
}, info) => {
  const onboarding = await openExtensionPage('onboarding.html');
  await onboarding.getByRole('button', { name: 'Next: AI notes' }).click();
  await expect(onboarding.getByRole('heading', { name: 'Turn on AI notes' })).toBeVisible();
  await expect(onboarding.getByText('trailmap-companion install', { exact: true })).toBeVisible();
  installCompanion();
  await expect(onboarding.getByText('Companion connected', { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(onboarding.getByText('trailmap-companion install', { exact: true })).toHaveCount(0);
  await onboarding.getByRole('button', { name: 'Next: Model providers' }).click();
  await expect(onboarding.getByRole('heading', { name: 'Model providers' })).toBeVisible();
  await onboarding.getByRole('button', { name: 'Next: Optional extras' }).click();
  await expect(onboarding.getByRole('heading', { name: 'Obsidian sync' })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Import history' })).toBeDisabled();
  await onboarding.screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'optional-extras.png') : info.outputPath('optional-extras.png') });
  await onboarding.getByRole('link', { name: 'Finish setup' }).click();
  await expect(onboarding).toHaveURL(/\/journal\.html$/);
});

test('Settings can remove a skip added on the onboarding privacy screen', async ({
  openExtensionPage, context, fixtureUrl, readVisits,
}, info) => {
  const onboarding = await openExtensionPage('onboarding.html');
  await onboarding.getByLabel('Site to skip').fill('skip.test');
  await onboarding.getByRole('button', { name: 'Add site' }).click();
  await expect(onboarding.getByRole('button', { name: 'Remove skip.test from skip list' })).toBeVisible();
  await onboarding.getByRole('link', { name: 'Open Settings' }).click();
  await expect(onboarding.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await onboarding.getByRole('button', { name: 'Remove skip.test from skip list' }).click();
  await expect(onboarding.getByText('No extra sites skipped.')).toBeVisible();
  const page = await context.newPage();
  await page.goto(fixtureUrl('skip.test', '/trail/start.html'));
  await expect.poll(async () => (await readVisits()).map(({ url }) => url)).toContain(page.url());
  await onboarding.screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'settings.png') : info.outputPath('settings.png'), fullPage: true });
});
