import { expect, test } from './fixtures';

const ARTICLE = '/content/article.html';

test('Chromium registers the pause and resume command with its suggested shortcut', async ({ serviceWorker }) => {
  const worker = await serviceWorker();
  // Headless Linux Chromium may leave a suggested key unbound, so check what the extension controls:
  // the command exists and the manifest suggests Alt+Shift+P.
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  expect(commands).toContainEqual(expect.objectContaining({ name: 'toggle-recording' }));
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  const suggested = manifest.commands?.['toggle-recording']?.suggested_key;
  expect(typeof suggested === 'string' ? suggested : suggested?.default).toBe('Alt+Shift+P');
});

test('default-denied and localhost navigations store nothing and show a skipped badge', async ({
  context, fixtureUrl, readCapture, serviceWorker,
}) => {
  const worker = await serviceWorker();
  for (const host of ['mail.test', 'localhost']) {
    const page = await context.newPage();
    const url = fixtureUrl(host, ARTICLE);
    await page.goto(url);
    await expect.poll(() => worker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      return tab?.id === undefined ? undefined : chrome.action.getBadgeText({ tabId: tab.id });
    }, url)).toBe('SKIP');
    await page.locator('#highlight').selectText();
    await page.keyboard.press('ControlOrMeta+c');
  }

  const allowed = fixtureUrl('learn.test', ARTICLE);
  await (await context.newPage()).goto(allowed);
  // Extraction provides a barrier after the delayed capture of the denied documents.
  await expect.poll(async () => (await readCapture('pages')).map((row) => new URL(row.canonicalUrl).hostname))
    .toEqual(['learn.test']);
  expect((await readCapture('visits')).map((visit) => visit.url)).toEqual([allowed]);
  expect(await readCapture('queries')).toEqual([]);
  expect(await readCapture('highlights')).toEqual([]);
});

test('the side panel pauses immediately, resumes on the next navigation and updates the badge', async ({
  context, fixtureUrl, openExtensionPage, readCapture, serviceWorker,
}, testInfo) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 640 });
  const page = await context.newPage();
  const first = fixtureUrl('learn.test', '/trail/start.html');
  await page.goto(first);
  await expect.poll(async () => (await readCapture('visits')).map((visit) => visit.url)).toEqual([first]);
  const recording = panel.getByRole('switch', { name: 'Record browsing' });
  const worker = await serviceWorker();
  const badge = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id === undefined ? undefined : chrome.action.getBadgeText({ tabId: tab.id });
  });

  await expect(recording).toBeChecked();
  await expect(panel.getByRole('textbox', { name: 'Page note' })).toBeVisible();
  await expect.poll(badge).toBe('ON');
  await recording.evaluate((input: HTMLInputElement) => input.click());
  await expect(recording).not.toBeChecked();
  await expect.poll(badge).toBe('OFF');
  await expect(panel.getByText('This page isn’t recorded.')).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Page note' })).toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath('recording-paused.png') });
  await page.goto(fixtureUrl('learn.test', ARTICLE));
  await page.locator('#highlight').selectText();
  await page.keyboard.press('ControlOrMeta+c');

  await recording.evaluate((input: HTMLInputElement) => input.click());
  await expect(recording).toBeChecked();
  await expect.poll(badge).toBe('ON');
  const resumed = fixtureUrl('learn.test', '/trail/article.html');
  await page.goto(resumed);
  await expect.poll(async () => (await readCapture('visits')).map((visit) => visit.url).sort())
    .toEqual([first, resumed].sort());
  expect(await readCapture('pages')).toEqual([]);
  expect(await readCapture('queries')).toEqual([]);
  expect(await readCapture('highlights')).toEqual([]);
});

test('a password field in a frame purges the top Visit and its captured Page', async ({ context, fixtureUrl, readCapture, serviceWorker }) => {
  const page = await context.newPage();
  const top = fixtureUrl('learn.test', '/content/article.html');
  const child = fixtureUrl('frame.test', '/login.html');
  await page.route(child, (route) => route.fulfill({ contentType: 'text/html', body: '<input type="password">' }));
  await page.goto(top);
  await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.includes('Tombstones'))).toBe(true);
  await page.evaluate((url) => {
    const frame = document.createElement('iframe');
    frame.src = url;
    document.body.append(frame);
  }, child);
  const worker = await serviceWorker();
  await expect.poll(() => worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    return tab?.id === undefined ? undefined : chrome.action.getBadgeText({ tabId: tab.id });
  }, top)).toBe('SKIP');
  await expect.poll(async () => (await readCapture('visits')).some(({ url }) => url === top)).toBe(false);
  expect(await readCapture('pages')).toEqual([]);
});

test('the side panel purges earlier Visits and Queries for a skipped site and prevents new capture', async ({
  context, fixtureUrl, openExtensionPage, readCapture, serviceWorker,
}, testInfo) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 640 });
  const page = await context.newPage();
  await page.route('https://www.google.com/search?*', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Search fixture</title><p>Fixture result</p>',
  }));
  const first = 'https://www.google.com/search?q=before';
  await page.goto(first);
  await expect.poll(async () => (await readCapture('queries')).map((row) => row.q)).toEqual(['before']);
  const site = panel.getByRole('switch', { name: 'Record www.google.com' });
  await expect(site).toBeChecked();
  await expect(panel.getByRole('textbox', { name: 'Page note' })).toBeVisible();
  await site.evaluate((input: HTMLInputElement) => input.click());
  await expect(site).not.toBeChecked();
  await expect(panel.getByText('This page isn’t recorded.')).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Page note' })).toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath('site-skipped.png') });
  const second = 'https://www.google.com/search?q=private';
  await page.goto(second);
  const worker = await serviceWorker();
  await expect.poll(() => worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    return tab?.id === undefined ? undefined : chrome.action.getBadgeText({ tabId: tab.id });
  }, second)).toBe('SKIP');

  const allowed = fixtureUrl('learn.test', '/trail/start.html');
  await page.goto(allowed);
  await expect.poll(async () => (await readCapture('visits')).map((row) => row.url)).toEqual([allowed]);
  expect(await readCapture('queries')).toEqual([]);

  await page.goto(second);
  await expect(site).not.toBeChecked();
  await site.evaluate((input: HTMLInputElement) => input.click());
  await expect(site).toBeChecked();
  await page.goto('https://www.google.com/search?q=after');
  await expect.poll(async () => (await readCapture('queries')).map((row) => row.q).sort()).toEqual(['after']);
});
