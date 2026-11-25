import type { Visit } from '../packages/shared/src/domain';
import { FAKE_HOSTS } from './constants';
import { expect, test } from './fixtures';

const nodes = '.react-flow__node';
const edgeFrom = (source: string, target: string) => `.react-flow__edge[aria-label="Edge from ${source} to ${target}"]`;

test('the side panel opens today’s layered trail with a Query and new-tab lineage', async ({ context, fixtureUrl, openExtensionPage, readVisits }, info) => {
  const startUrl = fixtureUrl(FAKE_HOSTS.learn, '/trail/start.html');
  const articleUrl = fixtureUrl(FAKE_HOSTS.learn, '/trail/article.html');
  const branchUrl = fixtureUrl(FAKE_HOSTS.learn, '/trail/other.html');
  const searchUrl = 'https://www.google.com/search?q=how+do+CRDTs+handle+deletes';
  await context.route(searchUrl, (route) => route.fulfill({
    contentType: 'text/html', body: '<title>Search results</title><h1>Search results</h1>',
  }));

  const source = await context.newPage();
  await source.goto(startUrl);
  await expect.poll(async () => (await readVisits()).some(({ url }) => url === startUrl)).toBe(true);
  const [branch] = await Promise.all([context.waitForEvent('page'), source.locator('#new-tab').click()]);
  await branch.waitForLoadState();
  await expect.poll(async () => (await readVisits()).some(({ url }) => url === branchUrl)).toBe(true);
  await source.locator('#same-tab').click();
  await branch.goto(searchUrl);
  const panel = await openExtensionPage('sidepanel.html');
  const [trail] = await Promise.all([
    context.waitForEvent('page'), panel.getByRole('link', { name: 'Open Trail' }).click(),
  ]);

  await expect(trail.getByRole('heading', { name: 'Trail', exact: true })).toBeVisible();
  await expect(trail.locator('.astryx-date-input').getByLabel('Trail day')).toBeVisible();
  await expect(trail.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  await expect(trail.locator(nodes)).toHaveCount(4);
  const start = trail.getByRole('link', { name: /Trail start/ });
  const article = trail.getByRole('link', { name: /Trail article/ });
  const other = trail.getByRole('link', { name: /Trail other page/ });
  await expect(trail.getByText('how do CRDTs handle deletes')).toBeVisible();
  await expect(trail.getByText('Search question')).toBeVisible();
  const visits = await readVisits();
  const visitId = (url: string) => visits.find((visit) => visit.url === url)!.id;
  await expect(trail.locator(edgeFrom(visitId(startUrl), visitId(articleUrl)))).toBeAttached();
  await expect(trail.locator(edgeFrom(visitId(startUrl), visitId(branchUrl)))).toBeAttached();

  const [startBox, articleBox, otherBox] = await Promise.all([start.boundingBox(), article.boundingBox(), other.boundingBox()]);
  expect(articleBox!.x).toBeGreaterThan(startBox!.x + startBox!.width);
  expect(otherBox!.x).toBeGreaterThan(startBox!.x + startBox!.width);
  expect(Math.max(articleBox!.y, otherBox!.y)).toBeGreaterThan(Math.min(articleBox!.y + articleBox!.height, otherBox!.y + otherBox!.height));
  await expect(start.locator('img')).toHaveJSProperty('complete', true);
  expect(await start.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await trail.screenshot({ path: info.outputPath('today.png') });

  await trail.getByRole('button', { name: 'Yesterday' }).click();
  await expect(trail.getByRole('heading', { name: 'No browsing on this day' })).toBeVisible();
  await expect(trail.locator(nodes)).toHaveCount(0);
  await trail.screenshot({ path: info.outputPath('yesterday-empty.png') });
  await trail.getByRole('button', { name: 'Today' }).click();
  await expect(trail.locator(nodes)).toHaveCount(4);

  const [reopened] = await Promise.all([context.waitForEvent('page'), article.click()]);
  await expect(reopened).toHaveURL(articleUrl);
});

test('the date picker loads 240 Visits for an older local day and the graph stays interactive', async ({ context, extensionId, fixtureUrl }) => {
  const origin = `chrome-extension://${extensionId}/`;
  const setup = context.pages().find((page) => page.url() === `${origin}onboarding.html`)!;
  const url = fixtureUrl(FAKE_HOSTS.learn, '/trail/article.html');
  await setup.evaluate(async (url) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('trailmap');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const start = +new Date(2025, 2, 9);
    const sample: Visit = {
      id: '', url, canonicalUrl: url, startedAt: start, title: '', activeMs: 12_000, tabId: 1,
      parentVisitId: null, transition: 'link', scrollDepth: 0, engagement: 'skimmed', expeditionId: null,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('visits', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      const store = tx.objectStore('visits');
      for (let i = 0; i < 240; i += 1) {
        store.put({ ...sample, id: `v${i}`, title: `Fixture Visit ${i}`, startedAt: start + i,
          parentVisitId: i % 30 === 0 ? null : `v${i - 1}` });
      }
      store.put({ ...sample, id: 'before', title: 'Before midnight', startedAt: start - 1 });
      store.put({ ...sample, id: 'after', title: 'Next midnight', startedAt: +new Date(2025, 2, 10) });
    });
    db.close();
  }, url);

  const trail = await context.newPage();
  const requested: string[] = [];
  trail.on('request', (request) => requested.push(request.url()));
  await trail.goto(`${origin}trail.html`);
  await expect(trail.getByRole('heading', { name: 'No browsing on this day' })).toBeVisible();
  const date = trail.getByLabel('Trail day');
  await date.fill('03/09/2025');
  await date.press('Tab');

  const viewport = trail.locator('.react-flow__viewport');
  await expect(trail.locator(nodes)).toHaveCount(240);
  await expect(trail.getByRole('link', { name: /Fixture Visit 0/ }).getByText('12s')).toBeVisible();
  await expect(trail.getByText('Before midnight')).toHaveCount(0);
  await expect(trail.getByText('Next midnight')).toHaveCount(0);
  const fitted = await viewport.evaluate((el) => el.style.transform);
  await trail.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => viewport.evaluate((el) => el.style.transform)).not.toBe(fitted);
  await trail.getByRole('button', { name: 'Fit trail' }).click();
  await expect.poll(() => viewport.evaluate((el) => el.style.transform)).toBe(fitted);
  expect(requested.filter((request) => !request.startsWith(origin))).toEqual([]);
});
