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
  const nextAiNotes = onboarding.getByRole('button', { name: 'Next: AI notes' });
  await expect(nextAiNotes).toHaveAttribute('data-variant', 'primary');
  await nextAiNotes.click();
  await expect(onboarding.getByRole('heading', { name: 'Turn on AI notes' })).toBeVisible();
  await expect(onboarding.getByText('trailmap-companion install', { exact: true })).toBeVisible();
  const skip = onboarding.getByRole('button', { name: 'Skip AI setup' });
  await expect(skip).toHaveAttribute('data-variant', 'primary');
  installCompanion();
  await expect(onboarding.getByText('Companion connected', { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(onboarding.getByText('trailmap-companion install', { exact: true })).toHaveCount(0);
  await expect(skip).toHaveAttribute('data-variant', 'secondary');
  const nextProviders = onboarding.getByRole('button', { name: 'Next: Model providers' });
  await expect(nextProviders).toHaveAttribute('data-variant', 'primary');
  await nextProviders.click();
  await expect(onboarding.getByRole('heading', { name: 'Model providers' })).toBeVisible();
  const nextExtras = onboarding.getByRole('button', { name: 'Next: Optional extras' });
  await expect(nextExtras).toHaveAttribute('data-variant', 'primary');
  await nextExtras.click();
  await expect(onboarding.getByRole('heading', { name: 'Obsidian sync' })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Import history' })).toBeEnabled();
  const back = onboarding.getByRole('button', { name: 'Back', exact: true });
  await expect(back).toHaveAttribute('data-variant', 'secondary');
  await back.click();
  await expect(onboarding.getByRole('heading', { name: 'Model providers' })).toBeVisible();
  await nextExtras.click();
  await expect(onboarding.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings.html');
  const finish = onboarding.getByRole('button', { name: 'Finish setup' });
  await expect(finish).toHaveAttribute('data-variant', 'primary');
  await onboarding.setViewportSize({ width: 1280, height: 900 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await onboarding.emulateMedia({ colorScheme });
    const file = `optional-extras-${colorScheme}.png`;
    await onboarding.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, file) : info.outputPath(file) });
  }
  await finish.press('Space');
  await expect(onboarding).toHaveURL(/\/journal\.html$/);
  await expect(onboarding.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
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
