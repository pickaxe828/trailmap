import { EXTENSION_ID } from '../packages/extension/extension-key';
import { FAKE_HOSTS } from './constants';
import { expect, test } from './fixtures';

test('the extension loads with its stable extension ID', async ({ extensionId }) => {
  expect(extensionId).toBe(EXTENSION_ID);
});

test('the side panel page renders Astryx content saying recording is on', async ({ openExtensionPage }) => {
  const page = await openExtensionPage('sidepanel.html');
  await expect(page.getByRole('heading', { name: 'Trailmap' })).toBeVisible();
  await expect(page.getByText('Recording is on')).toBeVisible();
  await expect(page.locator('.astryx-heading')).toHaveCount(1);
  await expect(page.locator('.astryx-status-dot').first()).toBeVisible();
});

test('the onboarding page renders Astryx content', async ({ openExtensionPage }) => {
  const page = await openExtensionPage('onboarding.html');
  await expect(page.getByRole('heading', { name: 'Welcome to Trailmap' })).toBeVisible();
  await expect(page.locator('.astryx-heading').first()).toBeVisible();
});

test('installing the extension opens the onboarding tab by itself', async ({ context, extensionId }) => {
  const onboardingUrl = `chrome-extension://${extensionId}/onboarding.html`;
  await expect
    .poll(() => context.pages().some((p) => p.url() === onboardingUrl), { timeout: 10_000 })
    .toBe(true);
});

test('dark mode follows the operating system', async ({ openExtensionPage }) => {
  const page = await openExtensionPage('sidepanel.html');
  const headingColor = () => page.locator('.astryx-heading').evaluate((el) => getComputedStyle(el).color);

  await page.emulateMedia({ colorScheme: 'light' });
  const light = await headingColor();
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await headingColor();

  // Astryx's `mode="system"` uses CSS light-dark() tokens, so only computed styles change (no data-theme attribute).
  expect(dark).not.toBe(light);
});

test('fixture pages are served on fake hostnames', async ({ context, fixtureUrl }) => {
  const page = await context.newPage();
  await page.goto(fixtureUrl(FAKE_HOSTS.learn));
  await expect(page.locator('#host')).toHaveText('learn.test');
  await page.getByRole('link', { name: 'Read the article' }).click();
  await expect(page).toHaveURL(fixtureUrl(FAKE_HOSTS.learn, '/article.html'));
  await expect(page.getByRole('heading', { name: 'How CRDTs handle deletes' })).toBeVisible();
});

test('extension pages make no network requests outside the extension', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const requested: string[] = [];
  page.on('request', (req) => requested.push(req.url()));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByText('Recording is on')).toBeVisible();
  expect(requested.filter((url) => !url.startsWith(`chrome-extension://${extensionId}/`))).toEqual([]);
});
