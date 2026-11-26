import type { Page } from '@playwright/test';
import type { RecorderState } from '../packages/extension/src/capture/state-store';
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
  await expect(panel.locator('.astryx-tree-list-item-label', { hasText: 'Trail start' })).toBeVisible();

  await page.locator('#same-tab').click();
  await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, '/trail/article.html'));

  const start = panel.locator('.astryx-tree-list-item', { hasText: 'Trail start' });
  const article = panel.locator('.astryx-tree-list-item', { hasText: 'Trail article' });
  await expect(article).toBeVisible();
  const [startBox, articleBox] = [await start.locator('.astryx-tree-list-item-label').boundingBox(), await article.locator('.astryx-tree-list-item-label').boundingBox()];
  expect(articleBox!.x).toBeGreaterThan(startBox!.x);
});

test.describe('controlled capture clock', () => {
  test.use({ controlledCaptureClock: true });

  test('active time stops while the tab is in the background', async ({ context, fixtureUrl, readVisits, serviceWorker }) => {
    const startUrl = fixtureUrl(FAKE_HOSTS.learn, START);
    const otherUrl = fixtureUrl(FAKE_HOSTS.learn, '/trail/other.html');
    const worker = await serviceWorker();
    const advance = (ms: number) => worker.evaluate((ms) => {
      (globalThis as typeof globalThis & { captureTestTime: number }).captureTestTime += ms;
    }, ms);
    const active = (tabId: number) => worker.evaluate(async (tabId) => {
      const stored = await chrome.storage.session.get('trailmap.recorderState');
      const state = stored['trailmap.recorderState'] as RecorderState | undefined;
      return state?.activeTabByWindow[state.focusedWindowId] === tabId && !state.hiddenTabs.includes(tabId);
    }, tabId);

    const a = await openStart(context, fixtureUrl);
    const first = await visitFor(readVisits, startUrl);
    await expect.poll(() => active(first.tabId)).toBe(true);
    await advance(1_500);
    const b = await context.newPage();
    await b.goto(otherUrl);
    const second = await visitFor(readVisits, otherUrl);
    await expect.poll(() => active(second.tabId)).toBe(true);
    expect((await visitFor(readVisits, startUrl)).activeMs).toBe(1_500);
    await advance(2_500);
    await a.bringToFront();
    await expect.poll(() => active(first.tabId)).toBe(true);
    expect((await visitFor(readVisits, otherUrl)).activeMs).toBe(2_500);
    expect((await visitFor(readVisits, startUrl)).activeMs).toBe(1_500);
  });
});

test('the tab-to-Visit mapping survives the service worker being stopped', async ({ context, fixtureUrl, readVisits, extensionId }) => {
  const startUrl = fixtureUrl(FAKE_HOSTS.learn, START);
  const page = await openStart(context, fixtureUrl);
  const start = await visitFor(readVisits, startUrl);

  // Stop the extension's service worker the way Chrome does when it is idle.
  const onboarding = context.pages().find((p) => p.url().includes(extensionId))!;
  const cdp = await context.newCDPSession(onboarding);
  const versions = new Map<string, { versionId: string; runningStatus: string; scriptURL: string }>();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updated }) => {
    for (const v of updated) versions.set(v.versionId, v);
  });
  await cdp.send('ServiceWorker.enable');
  await expect
    .poll(() => [...versions.values()].some((v) => v.scriptURL.includes(extensionId) && v.runningStatus === 'running'))
    .toBe(true);
  for (const v of versions.values()) if (v.scriptURL.includes(extensionId)) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  await expect
    .poll(() => [...versions.values()].filter((v) => v.scriptURL.includes(extensionId)).every((v) => v.runningStatus !== 'running'))
    .toBe(true);

  // The next navigation wakes a fresh worker, which must still know the tab's current Visit.
  await page.locator('#same-tab').click();
  const article = await visitFor(readVisits, fixtureUrl(FAKE_HOSTS.learn, '/trail/article.html'));
  expect(article).toMatchObject({ transition: 'link', parentVisitId: start.id });
});
