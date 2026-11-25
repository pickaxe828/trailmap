import type { Page } from '@playwright/test';
import { FAKE_HOSTS } from './constants';
import { expect, test } from './fixtures';

const START = '/trail/start.html';

type Fixtures = Parameters<Parameters<typeof test>[2]>[0];

/** Polls the recorded Visits until one for `url` exists, and returns it. */
async function visitFor(readVisits: Fixtures['readVisits'], url: string) {
  await expect.poll(async () => (await readVisits()).some((v) => v.url === url), { timeout: 10_000 }).toBe(true);
  return (await readVisits()).find((v) => v.url === url)!;
}

async function openStart(context: Fixtures['context'], fixtureUrl: Fixtures['fixtureUrl']): Promise<Page> {
  const page = await context.newPage();
  await page.goto(fixtureUrl(FAKE_HOSTS.learn, START));
  return page;
}

test('clicking a link records a Visit whose parent is the previous page', async ({ context, fixtureUrl, readVisits }) => {
  const page = await openStart(context, fixtureUrl);
  await page.locator('#same-tab').click();

  const start = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, START));
  const article = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, '/trail/article.html'));
  expect(start).toMatchObject({ transition: 'typed', parentVisitId: null });
  expect(article).toMatchObject({ transition: 'link', parentVisitId: start.id, tabId: start.tabId });
});

test('a link opened with target=_blank records a new-tab Visit branching from the source', async ({ context, fixtureUrl, readVisits }) => {
  const page = await openStart(context, fixtureUrl);
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#new-tab').click()]);
  await popup.waitForLoadState();

  const start = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, START));
  const other = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, '/trail/other.html'));
  expect(other).toMatchObject({ transition: 'new-tab', parentVisitId: start.id });
  expect(other.tabId).not.toBe(start.tabId);
});

test('form submissions, back navigation and pushState are recorded with the right transitions', async ({ context, fixtureUrl, readVisits }) => {
  const page = await openStart(context, fixtureUrl);
  const start = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, START));

  await page.locator('#push').click();
  const section = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, '/trail/start/section-two'));
  expect(section).toMatchObject({ transition: 'link', parentVisitId: start.id });

  await page.goto(fixtureUrl(FAKE_HOSTS.learn, START));
  await page.locator('#search').click();
  const results = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, '/trail/results.html?q=crdt'));
  expect(results.transition).toBe('form');

  await page.goBack();
  await expect
    .poll(async () => (await readVisits()).filter((v) => v.transition === 'back').length, { timeout: 10_000 })
    .toBe(1);
});

test('the side panel lists today\'s Visits indented under their parents and updates live', async ({ context, fixtureUrl, openExtensionPage, readVisits }) => {
  const panel = await openExtensionPage('sidepanel.html');
  await expect(panel.getByText('Your trail will appear here as you browse.')).toBeVisible();

  const page = await openStart(context, fixtureUrl);
  await expect(panel.getByText('Trail start')).toBeVisible();

  await page.locator('#same-tab').click();
  await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, '/trail/article.html'));

  const start = panel.locator('.astryx-tree-list-item', { hasText: 'Trail start' });
  const article = panel.locator('.astryx-tree-list-item', { hasText: 'Trail article' });
  await expect(article).toBeVisible();
  const [startBox, articleBox] = [await start.locator('.astryx-tree-list-item-label').boundingBox(), await article.locator('.astryx-tree-list-item-label').boundingBox()];
  expect(articleBox!.x).toBeGreaterThan(startBox!.x);
});
