import type { BrowserContext, Page } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import { signInToMockChatGpt, test as modelTest } from './model-fixtures';

// The capture rules key on the real host name, so (like the chat tests) the fixtures answer it through
// context.route. Nothing leaves the machine. The page shapes are reconstructions: see site/youtube/README.md.
const fixtures = fileURLToPath(new URL('site/youtube/', import.meta.url));
const WITH_CAPTIONS = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const WITHOUT_CAPTIONS = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const TITLE_AND_DESCRIPTION = 'Log-structured merge trees explained A walkthrough of memtables, SSTables and compaction.';
const NEXT_TITLE_AND_DESCRIPTION = 'Compaction strategies, no captions Leveled versus size-tiered compaction in an LSM tree.';

async function routeYoutube(context: BrowserContext) {
  const extraRequests: string[] = [];
  await context.route('https://www.youtube.com/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/player.js') return route.fulfill({ path: join(fixtures, 'player.js'), contentType: 'text/javascript' });
    if (!request.isNavigationRequest()) extraRequests.push(url.href);
    if (url.pathname !== '/watch') return route.fulfill({ status: 404 });
    const file = url.searchParams.get('v') === 'bbbbbbbbbbb' ? 'watch-no-captions.html' : 'watch.html';
    return route.fulfill({ path: join(fixtures, file), contentType: 'text/html' });
  });
  return extraRequests;
}

const pageText = async (readCapture: (table: 'pages') => Promise<{ canonicalUrl: string; text: string }[]>, url: string) =>
  (await readCapture('pages')).find(({ canonicalUrl }) => canonicalUrl === url)?.text;
const play = (page: Page) => page.evaluate(() => (window as unknown as { fixturePlay(): Promise<void> }).fixturePlay());

test('a captioned watch page stores only title and description without requesting captions', async ({
  context, readCapture,
}) => {
  const requests = await routeYoutube(context);
  const page = await context.newPage();
  await page.goto(WITH_CAPTIONS);
  await expect.poll(() => pageText(readCapture, WITH_CAPTIONS)).toBeDefined();
  expect(requests).toEqual([]);
  expect(await pageText(readCapture, WITH_CAPTIONS)).toBe(TITLE_AND_DESCRIPTION);
});

test('watch time, not scrolling or an open tab, drives engagement', async ({ context, readCapture }) => {
  await routeYoutube(context);
  const page = await context.newPage();
  await page.goto(WITH_CAPTIONS);
  await expect.poll(() => pageText(readCapture, WITH_CAPTIONS)).toBe(TITLE_AND_DESCRIPTION);
  const visit = async () => (await readCapture('visits')).find(({ url }) => url === WITH_CAPTIONS);
  expect(await visit()).toMatchObject({ engagement: 'bounced' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  await play(page);
  await expect.poll(async () => await visit(), { timeout: 30_000 })
    .toMatchObject({ engagement: 'skimmed', watchMs: expect.any(Number) });
  expect((await visit())?.watchMs).toBeGreaterThanOrEqual(10_000);
});

test('without captions it keeps the title and description only, and makes no caption request', async ({ context, readCapture }) => {
  const requests = await routeYoutube(context);
  const page = await context.newPage();
  await page.goto(WITHOUT_CAPTIONS);
  await expect.poll(() => pageText(readCapture, WITHOUT_CAPTIONS)).toBe(NEXT_TITLE_AND_DESCRIPTION);
  expect(requests).toEqual([]);
});

test('after a single-page navigation the new video is read from its own watch page, never the old data', async ({ context, readCapture }) => {
  const requests = await routeYoutube(context);
  const page = await context.newPage();
  await page.goto(WITH_CAPTIONS);
  await expect.poll(() => pageText(readCapture, WITH_CAPTIONS)).toBe(TITLE_AND_DESCRIPTION);
  await page.evaluate((url) => history.pushState({}, '', url), WITHOUT_CAPTIONS);
  await expect.poll(() => pageText(readCapture, WITHOUT_CAPTIONS)).toBe(NEXT_TITLE_AND_DESCRIPTION);
  expect(requests).toEqual([WITHOUT_CAPTIONS]);
});

test('paused recording and a skipped site do not capture video descriptions', async ({
  context, fixtureUrl, openExtensionPage, readCapture,
}) => {
  const requests = await routeYoutube(context);
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 640 });
  const page = await context.newPage();
  await page.goto(fixtureUrl('learn.test', '/trail/start.html'));
  await expect.poll(async () => (await readCapture('visits')).length).toBe(1);
  const recorded = async (suffix: string) => (await readCapture('visits')).some(({ url }) => url.endsWith(suffix));

  // Paused: the video is not even a Visit. A normal page afterwards proves the earlier events were handled.
  const recording = panel.getByRole('switch', { name: 'Record browsing' });
  await expect(recording).toBeChecked();
  await recording.evaluate((input: HTMLInputElement) => input.click());
  await expect(recording).not.toBeChecked();
  await page.goto(WITH_CAPTIONS);
  await page.goto(fixtureUrl('learn.test', '/content/article.html'));
  await recording.evaluate((input: HTMLInputElement) => input.click());
  await expect(recording).toBeChecked();
  await page.goto(fixtureUrl('learn.test', '/trail/article.html'));
  await expect.poll(() => recorded('/trail/article.html')).toBe(true);
  expect(requests).toEqual([]);
  expect(await recorded('watch?v=aaaaaaaaaaa')).toBe(false);

  // Recorded, then skipped: the Visit and its Page are purged. A revisit and an SPA change do not read either video.
  await page.goto(WITH_CAPTIONS);
  await expect.poll(() => pageText(readCapture, WITH_CAPTIONS)).toBe(TITLE_AND_DESCRIPTION);
  await page.bringToFront();
  const site = panel.getByRole('switch', { name: 'Record www.youtube.com' });
  await expect(site).toBeChecked();
  await site.evaluate((input: HTMLInputElement) => input.click());
  await expect(site).not.toBeChecked();
  await expect.poll(() => recorded('watch?v=aaaaaaaaaaa')).toBe(false);
  await page.goto(WITH_CAPTIONS);
  await page.evaluate((url) => history.pushState({}, '', url), WITHOUT_CAPTIONS);
  await page.goto(fixtureUrl('learn.test', '/content/article.html'));
  await expect.poll(() => recorded('/content/article.html')).toBe(true);
  expect(requests).toEqual([]);
  const stored = JSON.stringify(await Promise.all((['visits', 'pages', 'highlights', 'queries'] as const).map((table) => readCapture(table))));
  expect(stored).not.toMatch(/memtables|SSTables|size-tiered/);
});

modelTest.describe('enrichment', () => {
  modelTest.use({ companionInstalled: true });

  modelTest('a watched video is enriched from its title and description and logged as sent to the model', async ({
    context, openExtensionPage, readCapture, mockOrigin,
  }) => {
    await routeYoutube(context);
    await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
    const page = await context.newPage();
    await page.goto(WITH_CAPTIONS);
    await expect.poll(() => pageText(readCapture, WITH_CAPTIONS)).toBe(TITLE_AND_DESCRIPTION);
    await play(page);
    await expect.poll(async () => (await readCapture('pages')).find(({ canonicalUrl }) => canonicalUrl === WITH_CAPTIONS)?.pageKind,
      { timeout: 45_000 }).toBe('video');
    const [enriched] = (await readCapture('pages')).filter(({ canonicalUrl }) => canonicalUrl === WITH_CAPTIONS);
    expect(enriched).toMatchObject({ summary: expect.stringContaining('log-structured merge tree'), conceptMentions: [{ name: 'SSTable' }] });
    const calls = await (await fetch(mockOrigin + '/test/calls')).json() as { input: { content: string }[] }[];
    const sent = calls.map(({ input }) => JSON.parse(input[0]!.content) as { contentKind?: string; text?: string }).filter(({ contentKind }) => contentKind === 'video');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe(TITLE_AND_DESCRIPTION);
    const audit = await readCapture('sentToModel');
    expect(audit.some(({ task }) => task === 'page_enrichment')).toBe(true);
  });
});
