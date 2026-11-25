import { expect, test } from './fixtures';

const ARTICLE = '/content/article.html';

test('Chromium registers the pause and resume shortcut', async ({ serviceWorker }) => {
  const worker = await serviceWorker();
  expect(await worker.evaluate(() => chrome.commands.getAll())).toContainEqual(expect.objectContaining({
    name: 'toggle-recording', shortcut: expect.stringMatching(/P$/),
  }));
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
}) => {
  const panel = await openExtensionPage('sidepanel.html');
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
  await expect.poll(badge).toBe('ON');
  await recording.evaluate((input: HTMLInputElement) => input.click());
  await expect(recording).not.toBeChecked();
  await expect.poll(badge).toBe('OFF');
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

test('the side panel skips a site across navigations without forgetting earlier Visits', async ({
  context, fixtureUrl, openExtensionPage, readCapture, serviceWorker,
}) => {
  const panel = await openExtensionPage('sidepanel.html');
  const page = await context.newPage();
  await page.route('https://www.google.com/search?*', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Search fixture</title><p>Fixture result</p>',
  }));
  const first = 'https://www.google.com/search?q=before';
  await page.goto(first);
  await expect.poll(async () => (await readCapture('queries')).map((row) => row.q)).toEqual(['before']);
  const site = panel.getByRole('switch', { name: 'Record www.google.com' });
  await expect(site).toBeChecked();
  await site.evaluate((input: HTMLInputElement) => input.click());
  await expect(site).not.toBeChecked();
  await expect(panel.getByText('Site is skipped')).toBeVisible();
  const second = 'https://www.google.com/search?q=private';
  await page.goto(second);
  const worker = await serviceWorker();
  await expect.poll(() => worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    return tab?.id === undefined ? undefined : chrome.action.getBadgeText({ tabId: tab.id });
  }, second)).toBe('SKIP');

  const allowed = fixtureUrl('learn.test', '/trail/start.html');
  await page.goto(allowed);
  await expect.poll(async () => (await readCapture('visits')).map((row) => row.url).sort()).toEqual([first, allowed].sort());
  expect((await readCapture('queries')).map((row) => row.q)).toEqual(['before']);

  await page.goto(second);
  await expect(site).not.toBeChecked();
  await site.evaluate((input: HTMLInputElement) => input.click());
  await expect(site).toBeChecked();
  await page.goto('https://www.google.com/search?q=after');
  await expect.poll(async () => (await readCapture('queries')).map((row) => row.q).sort()).toEqual(['after', 'before']);
});
