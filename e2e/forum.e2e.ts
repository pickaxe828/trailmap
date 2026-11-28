import type { BrowserContext, Page } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';

// The capture rules key on the real host names, so (like the chat and YouTube tests) the fixtures answer those hosts
// through context.route. Nothing leaves the machine. The page shapes are reconstructions: see site/forum/README.md.
const fixtures = fileURLToPath(new URL('site/forum/', import.meta.url));
const OLD = 'https://old.reddit.com/r/databases/comments/abc123/why_does_compaction_hurt_write_throughput/';
const NEW = 'https://www.reddit.com/r/databases/comments/abc123/why_does_compaction_hurt_write_throughput/';
const FEED = 'https://www.reddit.com/r/databases/';
const HN = 'https://news.ycombinator.com/item?id=4242001';
const HN_UNKNOWN = 'https://news.ycombinator.com/item?id=777';
const NAMES = /otter_dev|compaction_fan|leveled_lover|plain_mention|write_amp|bloom_filter|flagged_user|sidebar_ghost|some_account/;

async function routeForums(context: BrowserContext) {
  const file = (name: string) => ({ path: join(fixtures, name), contentType: 'text/html' });
  await context.route('https://old.reddit.com/**', (route) => route.fulfill(file('reddit-old.html')));
  await context.route('https://www.reddit.com/**', (route) =>
    route.fulfill(file(new URL(route.request().url()).pathname.includes('/comments/') ? 'reddit-new.html' : 'reddit-feed.html')));
  await context.route('https://news.ycombinator.com/**', (route) =>
    route.fulfill(file(new URL(route.request().url()).searchParams.get('id') === '777' ? 'unknown-layout.html' : 'hn-item.html')));
}

const toggle = (settings: Page) => settings.getByRole('switch', { name: 'Capture Reddit thread pages' });
async function setOptIn(settings: Page, on: boolean) {
  await expect(toggle(settings)).toBeEnabled(); // Enabled once the stored settings have loaded.
  await toggle(settings).click(); // The switch follows the stored setting, so check() would race the save.
  if (on) await expect(toggle(settings)).toBeChecked();
  else await expect(toggle(settings)).not.toBeChecked();
}
const pageText = async (readCapture: (table: 'pages') => Promise<{ canonicalUrl: string; text: string }[]>, url: string) =>
  (await readCapture('pages')).find(({ canonicalUrl }) => canonicalUrl === url)?.text;

test('Reddit threads and feeds are skipped until the opt-in: nothing is stored from them', async ({ context, fixtureUrl, readCapture }) => {
  await routeForums(context);
  for (const url of [NEW, OLD, FEED]) await (await context.newPage()).goto(url);
  // A normal page's capture is the barrier: it proves the Reddit pages were handled first.
  const allowed = fixtureUrl('learn.test', '/content/article.html');
  await (await context.newPage()).goto(allowed);
  await expect.poll(async () => (await readCapture('visits')).map(({ url }) => url)).toEqual([allowed]);
  expect(JSON.stringify(await readCapture('pages'))).not.toMatch(/compaction|secret feed marker/);
});

// Both Reddit fixtures name the www thread as their canonical link, so that is the Page's key whichever layout was read.
for (const [layout, url] of [['new Reddit', NEW], ['old Reddit', OLD]] as const) {
  test(`${layout}: after the opt-in a thread keeps the post and top comments, nested, without any user name`, async ({
    context, readCapture, openExtensionPage,
  }) => {
    await routeForums(context);
    const settings = await openExtensionPage('settings.html');
    await setOptIn(settings, true);
    const page = await context.newPage();
    await page.goto(url);
    await expect.poll(() => pageText(readCapture, NEW)).toContain('Size-tiered favours writes');
    const text = (await pageText(readCapture, NEW))!;
    expect(text.startsWith('Why does compaction hurt write throughput?\n')).toBe(true);
    expect(text).toContain('Our LSM tree stalls writes whenever compaction runs.');
    expect(text).toContain('\n  - Leveled compaction rewrites each byte about ten times');
    expect(text).toContain('Thanks to [user] for the benchmark');
    expect(text).not.toMatch(NAMES);
    expect(text).not.toMatch(/load more|View more comments|Subreddit rules|\[deleted\]|\[removed\]/);
    expect(JSON.stringify([await readCapture('pages'), await readCapture('visits')])).not.toMatch(NAMES);
  });
}

test('a feed stays skipped even after the opt-in', async ({ context, fixtureUrl, readCapture, openExtensionPage }) => {
  await routeForums(context);
  const settings = await openExtensionPage('settings.html');
  await setOptIn(settings, true);
  await (await context.newPage()).goto(FEED);
  const allowed = fixtureUrl('learn.test', '/content/article.html');
  await (await context.newPage()).goto(allowed);
  await expect.poll(async () => (await readCapture('visits')).map(({ url }) => url)).toEqual([allowed]);
  expect(JSON.stringify(await readCapture('pages'))).not.toContain('secret feed marker');
});

test('a thread open when the user opts in is not read from before the opt-in; it is captured once it is loaded again', async ({
  context, fixtureUrl, readCapture, openExtensionPage,
}) => {
  await routeForums(context);
  const thread = await context.newPage();
  await thread.goto(NEW);
  const settings = await openExtensionPage('settings.html');
  await setOptIn(settings, true);
  // The thread was skipped when it loaded, so it has no Visit and nothing on it is read now (same as un-skipping a site).
  // A normal page's capture is the barrier.
  const allowed = fixtureUrl('learn.test', '/content/article.html');
  await (await context.newPage()).goto(allowed);
  await expect.poll(async () => (await readCapture('visits')).map(({ url }) => url)).toEqual([allowed]);
  await thread.bringToFront();
  await thread.reload();
  await expect.poll(() => pageText(readCapture, NEW)).toContain('Size-tiered favours writes');
});

test('Hacker News needs no opt-in and keeps the story and comments without user names', async ({ context, readCapture }) => {
  await routeForums(context);
  await (await context.newPage()).goto(HN);
  await expect.poll(() => pageText(readCapture, HN)).toContain('Size-tiered favours writes');
  const text = (await pageText(readCapture, HN))!;
  expect(text.startsWith('Leveled versus size-tiered compaction\n')).toBe(true);
  expect(text).toContain('\n  - Leveled compaction rewrites each byte about ten times');
  expect(text).not.toMatch(NAMES);
  expect(text).not.toMatch(/\[flagged\]|Hacker News/);
});

test('a thread in an unknown layout stores no Page text, not a Readability guess', async ({ context, fixtureUrl, readCapture }) => {
  await routeForums(context);
  await (await context.newPage()).goto(HN_UNKNOWN);
  await expect.poll(async () => (await readCapture('visits')).map(({ url }) => url)).toContain(HN_UNKNOWN);
  // A normal page's capture text is the barrier: the unknown thread's extraction ran (and returned nothing) before it.
  const allowed = fixtureUrl('learn.test', '/content/article.html');
  await (await context.newPage()).goto(allowed);
  await expect.poll(async () => (await readCapture('pages')).map(({ canonicalUrl }) => canonicalUrl)).toContain('http://learn.test:4173/replicated-lists?chapter=2');
  expect(JSON.stringify(await readCapture('pages'))).not.toContain('Mystery');
});

test('turning the opt-in off removes the captured Reddit threads and stops capture; Hacker News stays', async ({
  context, readCapture, openExtensionPage,
}) => {
  await routeForums(context);
  const settings = await openExtensionPage('settings.html');
  await setOptIn(settings, true);
  await (await context.newPage()).goto(NEW);
  await expect.poll(() => pageText(readCapture, NEW)).toContain('Size-tiered favours writes');
  await (await context.newPage()).goto(HN);
  await expect.poll(() => pageText(readCapture, HN)).toContain('Size-tiered favours writes');

  await settings.bringToFront();
  await setOptIn(settings, false);
  await expect.poll(async () => (await readCapture('visits')).map(({ url }) => url)).toEqual([HN]);
  expect((await readCapture('pages')).map(({ canonicalUrl }) => canonicalUrl)).toEqual([HN]);

  await (await context.newPage()).goto(OLD);
  // Settings is a normal extension page, so its own state is the barrier... but a later HN capture is the real one.
  await (await context.newPage()).goto(HN_UNKNOWN);
  await expect.poll(async () => (await readCapture('visits')).map(({ url }) => url)).toContain(HN_UNKNOWN);
  expect((await readCapture('visits')).map(({ url }) => url)).not.toContain(OLD);
});
