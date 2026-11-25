import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Transition, Visit } from '@trailmap/shared';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { canonicalizeUrl } from './canonical';
import { VisitRecorder, type VisitChange } from './recorder';
import type { NavTransitionQualifier, NavTransitionType } from './events';
import { MemoryStateStore } from './state-store';
import { FakeBrowser, FakeClock } from './testing';

const LEARN = 'http://learn.test:4173';
const TAB = 1;
const WINDOW = 1;

let db: TrailmapDb;
let browser: FakeBrowser;
let clock: FakeClock;
let store: MemoryStateStore;
let recorder: VisitRecorder;

let nextId = 0; // shared across restarts, like the random ids in production

function createRecorder() {
  const r = new VisitRecorder({ db, source: browser, store, now: clock.now, newId: () => `v${++nextId}` });
  r.start();
  return r;
}

async function visits(): Promise<Visit[]> {
  return db.visits.orderBy('startedAt').toArray();
}
const byUrl = async (url: string) => (await visits()).find((v) => v.url === url);

beforeEach(async () => {
  nextId = 0;
  db = openTrailmapDb(`trailmap-test-${crypto.randomUUID()}`);
  browser = new FakeBrowser();
  clock = new FakeClock();
  store = new MemoryStateStore();
  recorder = createRecorder();
  await recorder.ready;
});

afterEach(async () => {
  db.close();
  await db.delete();
});

test('a Visit updates engagement from time, scroll and selection, then stops accruing on navigation', async () => {
  const first = `${LEARN}/article`;
  await browser.focusWindow(WINDOW);
  await browser.activateTab(TAB, WINDOW);
  await browser.commit(TAB, first);
  clock.advance(10_000);
  await browser.tick();
  expect(await byUrl(first)).toMatchObject({ engagement: 'skimmed' });

  await browser.reportPageContent(TAB, first, { kind: 'scroll', depth: 0.51 });
  expect(await byUrl(first)).toMatchObject({ engagement: 'read' });
  const second = `${LEARN}/another`;
  await browser.commit(TAB, second);
  await browser.reportPageContent(TAB, second, { kind: 'selection' });
  expect(await byUrl(second)).toMatchObject({ engagement: 'read' });
  clock.advance(60_001);
  await browser.tick();
  expect(await byUrl(first)).toMatchObject({ activeMs: 10_000, engagement: 'read' });
  expect(await byUrl(second)).toMatchObject({ activeMs: 60_001, engagement: 'read' });
});

test('pausing ends the active Visit and resuming does not admit its stale content', async () => {
  let paused = false;
  recorder = new VisitRecorder({ db, source: browser, store, now: clock.now,
    newId: () => `v${++nextId}`, shouldRecord: () => !paused });
  recorder.start();
  await browser.focusWindow(WINDOW);
  await browser.activateTab(TAB, WINDOW);
  const first = `${LEARN}/article`;
  await browser.commit(TAB, first);
  clock.advance(10_000);
  await recorder.changeRecordingPolicy(async () => { paused = true; });
  clock.advance(60_000);
  await recorder.changeRecordingPolicy(async () => { paused = false; });
  await browser.reportPageContent(TAB, first, { kind: 'highlight', source: 'copy', text: 'Do not save' });
  const next = `${LEARN}/another`;
  await browser.commit(TAB, next);
  expect(await byUrl(first)).toMatchObject({ activeMs: 10_000, engagement: 'skimmed' });
  expect(await byUrl(next)).toMatchObject({ parentVisitId: null });
  expect(await db.highlights.count()).toBe(0);
});

test('forgetting the Visit shown in a tab stops its capture and starts the next trail fresh', async () => {
  const first = `${LEARN}/article`;
  await browser.focusWindow(WINDOW);
  await browser.activateTab(TAB, WINDOW);
  await browser.commit(TAB, first);
  const shown = (await byUrl(first))!;
  const removed = await recorder.forgetVisits(async () => {
    await db.visits.delete(shown.id);
    return [shown.id];
  });
  expect(removed).toEqual([shown.id]);
  expect(recorder.getCurrentVisit(TAB)).toBeUndefined();

  await browser.reportPageContent(TAB, first, { kind: 'highlight', source: 'copy', text: 'Forgotten text' });
  clock.advance(5_000);
  await browser.tick();
  expect(await db.highlights.count()).toBe(0);
  expect(await db.visits.count()).toBe(0);
  const next = `${LEARN}/another`;
  await browser.commit(TAB, next, { transitionType: 'link' });
  expect(await byUrl(next)).toMatchObject({ parentVisitId: null });
});

describe('navigation lineage', () => {
  test('clicking a link creates a Visit whose parent is the previous page in that tab', async () => {
    await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'typed' });
    clock.advance(5_000);
    await browser.commit(TAB, `${LEARN}/article.html`, { transitionType: 'link' });

    const first = await byUrl(`${LEARN}/index.html`);
    const second = await byUrl(`${LEARN}/article.html`);
    expect(second?.transition).toBe('link');
    expect(second?.parentVisitId).toBe(first?.id ?? 'missing');
    expect(second?.tabId).toBe(TAB);
    expect(second?.startedAt).toBe(clock.time);
  });
});

describe('transitions', () => {
  const cases: [string, NavTransitionType, NavTransitionQualifier[], Transition][] = [
    ['typed', 'typed', [], 'typed'],
    ['an omnibox search or keyword', 'generated', [], 'typed'],
    ['a form submission', 'form_submit', [], 'form'],
    ['a reload', 'reload', [], 'reload'],
    ['a bookmark', 'auto_bookmark', [], 'bookmark'],
    ['the start page', 'start_page', [], 'auto'],
    ['back or forward', 'link', ['forward_back'], 'back'],
    ['back typed in the address bar', 'typed', ['forward_back', 'from_address_bar'], 'back'],
  ];
  for (const [label, transitionType, qualifiers, expected] of cases) {
    test(`${label} is recorded as "${expected}"`, async () => {
      await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'typed' });
      await browser.commit(TAB, `${LEARN}/article.html`, { transitionType, qualifiers });
      expect((await byUrl(`${LEARN}/article.html`))?.transition).toBe(expected);
    });
  }

  test('typed, bookmark and start-page navigations start a new trail instead of hanging off the last page', async () => {
    await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.commit(TAB, `${LEARN}/typed.html`, { transitionType: 'typed' });
    await browser.commit(TAB, `${LEARN}/bookmarked.html`, { transitionType: 'auto_bookmark' });
    expect((await byUrl(`${LEARN}/typed.html`))?.parentVisitId).toBeNull();
    expect((await byUrl(`${LEARN}/bookmarked.html`))?.parentVisitId).toBeNull();
  });

  test('form submissions and back/forward hang off the previous page, like links', async () => {
    await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.commit(TAB, `${LEARN}/results.html`, { transitionType: 'form_submit' });
    await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'link', qualifiers: ['forward_back'] });
    const [first, results, again] = await visits();
    expect(results?.parentVisitId).toBe(first?.id ?? 'missing');
    expect(again?.parentVisitId).toBe(results?.id ?? 'missing');
  });

  test('a reload becomes a sibling of the page it reloaded, not a child of it', async () => {
    await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.commit(TAB, `${LEARN}/article.html`);
    await browser.commit(TAB, `${LEARN}/article.html`, { transitionType: 'reload' });
    const [first, article, reloaded] = await visits();
    expect(article?.parentVisitId).toBe(first?.id ?? 'missing');
    expect(reloaded?.parentVisitId).toBe(first?.id ?? 'missing');
  });

  test('navigations in different tabs do not become each other\'s parents', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    await browser.commit(2, `${LEARN}/b.html`, { transitionType: 'typed' });
    await browser.commit(2, `${LEARN}/c.html`);
    const [a, b, c] = await visits();
    expect(c?.parentVisitId).toBe(b?.id ?? 'missing');
    expect(a?.parentVisitId).toBeNull();
  });

  test('subframe navigations are ignored', async () => {
    await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.commit(TAB, `${LEARN}/ad.html`, { frameId: 5, transitionType: 'auto_subframe' });
    expect(await visits()).toHaveLength(1);
  });
});

describe('links opened in a new tab', () => {
  test('create a new-tab Visit branching from the source tab\'s current Visit', async () => {
    await browser.commit(1, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.openInNewTab(1, 2, `${LEARN}/article.html`);
    await browser.commit(2, `${LEARN}/article.html`, { transitionType: 'link' });

    const [source, branch] = await visits();
    expect(branch?.transition).toBe('new-tab');
    expect(branch?.tabId).toBe(2);
    expect(branch?.parentVisitId).toBe(source?.id ?? 'missing');
  });

  test('only the first navigation in the new tab is a new-tab Visit; later ones follow the new tab\'s own trail', async () => {
    await browser.commit(1, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.openInNewTab(1, 2, `${LEARN}/article.html`);
    await browser.commit(2, `${LEARN}/article.html`);
    await browser.commit(2, `${LEARN}/deeper.html`);

    const [, branch, deeper] = await visits();
    expect(deeper?.transition).toBe('link');
    expect(deeper?.parentVisitId).toBe(branch?.id ?? 'missing');
  });

  test('branch from the Visit that was current when the link was clicked, even if the source tab moves on first', async () => {
    await browser.commit(1, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.openInNewTab(1, 2, `${LEARN}/article.html`);
    await browser.commit(1, `${LEARN}/elsewhere.html`);
    await browser.commit(2, `${LEARN}/article.html`);

    const [source, , branch] = await visits();
    expect(branch?.tabId).toBe(2);
    expect(branch?.parentVisitId).toBe(source?.id ?? 'missing');
  });

  test('a source tab with no recorded Visit gives a new-tab Visit with no parent', async () => {
    await browser.openInNewTab(1, 2, `${LEARN}/article.html`);
    await browser.commit(2, `${LEARN}/article.html`);
    expect((await visits())[0]).toMatchObject({ transition: 'new-tab', parentVisitId: null });
  });
});

describe('single-page apps', () => {
  test('a pushState navigation creates a Visit under the previous one', async () => {
    await browser.commit(TAB, `${LEARN}/spa.html`, { transitionType: 'typed' });
    await browser.pushState(TAB, `${LEARN}/spa/section-2`);
    await browser.pushState(TAB, `${LEARN}/spa/section-3`);

    const [page, two, three] = await visits();
    expect(two).toMatchObject({ url: `${LEARN}/spa/section-2`, transition: 'link', parentVisitId: page?.id });
    expect(three?.parentVisitId).toBe(two?.id ?? 'missing');
  });

  test('a history-state update that keeps the same URL is not a new Visit', async () => {
    await browser.commit(TAB, `${LEARN}/spa.html`, { transitionType: 'typed' });
    await browser.pushState(TAB, `${LEARN}/spa.html`);
    expect(await visits()).toHaveLength(1);
  });

  test('subframe history updates are ignored', async () => {
    await browser.commit(TAB, `${LEARN}/spa.html`, { transitionType: 'typed' });
    await browser.pushState(TAB, `${LEARN}/frame/next`, { frameId: 3 });
    expect(await visits()).toHaveLength(1);
  });
});

describe('what counts as a Visit', () => {
  test('only http(s) pages are recorded; browser and extension pages are not', async () => {
    await browser.commit(TAB, 'chrome://newtab/', { transitionType: 'typed' });
    await browser.commit(TAB, 'chrome-extension://abc/sidepanel.html', { transitionType: 'typed' });
    await browser.commit(TAB, 'about:blank', { transitionType: 'typed' });
    expect(await visits()).toHaveLength(0);
  });

  test('leaving a recorded page for an unrecorded one ends the trail: the next link has no parent', async () => {
    await browser.commit(TAB, `${LEARN}/index.html`, { transitionType: 'typed' });
    await browser.commit(TAB, 'chrome://newtab/', { transitionType: 'typed' });
    await browser.commit(TAB, `${LEARN}/article.html`, { transitionType: 'link' });
    expect((await visits())[1]?.parentVisitId).toBeNull();
  });

  test('a shouldRecord option lets a later privacy filter veto URLs', async () => {
    recorder = new VisitRecorder({
      db, source: browser, store: new MemoryStateStore(), now: clock.now, newId: () => crypto.randomUUID(),
      shouldRecord: (url) => !url.includes('private'),
    });
    recorder.start();
    await recorder.ready;
    await browser.commit(TAB, `${LEARN}/private/inbox`, { transitionType: 'typed' });
    await browser.commit(TAB, `${LEARN}/public`, { transitionType: 'typed' });
    expect((await visits()).map((v) => v.url)).toEqual([`${LEARN}/public`]);
  });
});

describe('active time', () => {
  /** Window 1 focused, tab 1 active in it, user not idle. */
  async function startFocusedOnTab1() {
    browser.snapshotValue = { activeTabByWindow: { [WINDOW]: 1 }, focusedWindowId: WINDOW, idleState: 'active' };
    recorder = createRecorder();
    await recorder.ready;
  }
  const activeMs = async (url: string) => (await byUrl(url))?.activeMs;

  beforeEach(startFocusedOnTab1);

  test('counts the time a page is the one the user is looking at', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(5_000);
    await browser.commit(1, `${LEARN}/b.html`);
    clock.advance(2_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(5_000);
    expect(await activeMs(`${LEARN}/b.html`)).toBe(2_000);
  });

  test('stops counting when the tab is no longer active, and resumes when it is again', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(2_000);
    await browser.activateTab(2, WINDOW);
    clock.advance(10_000);
    await browser.activateTab(1, WINDOW);
    clock.advance(1_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(3_000);
  });

  test('a page opened in a background tab only counts once its tab is activated', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    await browser.openInNewTab(1, 2, `${LEARN}/b.html`);
    await browser.commit(2, `${LEARN}/b.html`);
    clock.advance(4_000);
    await browser.activateTab(2, WINDOW);
    clock.advance(1_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(4_000);
    expect(await activeMs(`${LEARN}/b.html`)).toBe(1_000);
  });

  test('stops counting when the browser window loses focus', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(2_000);
    await browser.blurBrowser();
    clock.advance(60_000);
    await browser.focusWindow(WINDOW);
    clock.advance(1_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(3_000);
  });

  test('does not count a tab that is active in a window other than the focused one', async () => {
    await browser.activateTab(9, 2); // a second window whose active tab is 9
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    await browser.focusWindow(2);
    clock.advance(5_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(0);
  });

  test.each(['idle', 'locked'] as const)('stops counting while the user is %s', async (state) => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(2_000);
    await browser.setIdle(state);
    clock.advance(60_000);
    await browser.setIdle('active');
    clock.advance(1_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(3_000);
  });

  test('stops counting while the page reports itself hidden', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(2_000);
    await browser.setPageVisible(1, false);
    clock.advance(60_000);
    await browser.setPageVisible(1, true);
    clock.advance(1_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(3_000);
  });

  test('closing a tab settles its time and removes it from the trail', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(3_000);
    await browser.closeTab(1);
    expect(await activeMs(`${LEARN}/a.html`)).toBe(3_000);
    expect(recorder.getCurrentVisit(1)).toBeUndefined();
  });

  test('closing the focused window stops counting', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(1_000);
    await browser.closeWindow(WINDOW);
    clock.advance(30_000);
    await browser.tick();
    expect(await activeMs(`${LEARN}/a.html`)).toBe(1_000);
  });

  test('listeners hear about every change to a Visit', async () => {
    const changes: VisitChange[] = [];
    recorder.subscribe((c) => changes.push(c));
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(1_000);
    await browser.tick();
    expect(changes.map((c) => c.type)).toEqual(['created', 'updated']);
    expect(changes[1]?.visit.activeMs).toBe(1_000);
  });

  test('a title reported for the current page is stored; a stale one is ignored', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    await browser.setTitle(1, `${LEARN}/a.html`, 'Page A');
    await browser.setTitle(1, `${LEARN}/old.html`, 'Stale');
    expect((await byUrl(`${LEARN}/a.html`))?.title).toBe('Page A');
  });
});

describe('service worker restarts', () => {
  /** The service worker dies and a new one starts: new recorder, same storage. */
  async function restartServiceWorker() {
    recorder = createRecorder();
    await recorder.ready;
  }

  beforeEach(async () => {
    browser.snapshotValue = { activeTabByWindow: { [WINDOW]: 1 }, focusedWindowId: WINDOW, idleState: 'active' };
    recorder = createRecorder();
    await recorder.ready;
  });

  test('the tab to current-Visit mapping survives, so the next link still has its parent', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    await restartServiceWorker();
    expect(recorder.getCurrentVisit(1)?.url).toBe(`${LEARN}/a.html`);
    await browser.commit(1, `${LEARN}/b.html`);
    const [a, b] = await visits();
    expect(b?.parentVisitId).toBe(a?.id ?? 'missing');
  });

  test('a link opened in a new tab just before the restart still branches from its source', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    await browser.openInNewTab(1, 2, `${LEARN}/b.html`);
    await restartServiceWorker();
    await browser.commit(2, `${LEARN}/b.html`);
    const [a, b] = await visits();
    expect(b).toMatchObject({ transition: 'new-tab', parentVisitId: a?.id });
  });

  test('active time carries on across the restart without losing or inventing time', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(3_000);
    await browser.tick();
    clock.advance(2_000); // the worker is asleep; the tab stays active, window focused, user present
    await restartServiceWorker();
    clock.advance(1_000);
    await browser.tick();
    expect((await byUrl(`${LEARN}/a.html`))?.activeMs).toBe(6_000);
  });

  test('focus lost before the restart is still known after it', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    await browser.blurBrowser();
    await restartServiceWorker();
    clock.advance(30_000);
    await browser.tick();
    expect((await byUrl(`${LEARN}/a.html`))?.activeMs).toBe(0);
  });

  test('restarting the browser forgets old tab ids and counts no time for the gap', async () => {
    await browser.commit(1, `${LEARN}/a.html`, { transitionType: 'typed' });
    clock.advance(3_600_000); // the browser was closed for an hour
    await browser.startBrowser();
    await browser.commit(1, `${LEARN}/b.html`, { transitionType: 'link' });
    const [a, b] = await visits();
    expect(a?.activeMs).toBe(0);
    expect(b?.parentVisitId).toBeNull();
  });
});

describe('canonicalizeUrl', () => {
  test('drops the fragment and tracking parameters but keeps real ones', () => {
    expect(canonicalizeUrl('http://learn.test/a?id=3&utm_source=x&fbclid=1#top')).toBe('http://learn.test/a?id=3');
  });
  test('returns something unparseable unchanged', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});

test('a new document reuses unchanged Page text and rejects the previous document at the same URL', async () => {
  const url = `${LEARN}/article.html`;
  const firstDocument = 'document-1';
  const secondDocument = 'document-2';
  const sourceHash = 'a'.repeat(64);
  const article = { kind: 'text', text: 'Tombstones preserve history.', textHash: 'b'.repeat(64), sourceHash } as const;

  await browser.commit(TAB, url, { documentId: firstDocument });
  const first = await browser.reportPageContent(TAB, url, { kind: 'probe', sourceHash }, firstDocument);
  expect(first?.extract).toBe(true);
  await browser.reportPageContent(TAB, url, { ...article, visitId: first!.visitId }, firstDocument);

  await browser.commit(TAB, url, { documentId: secondDocument, transitionType: 'reload' });
  recorder = createRecorder();
  const second = await browser.reportPageContent(TAB, url, { kind: 'probe', sourceHash }, secondDocument);
  expect(second).toEqual({ visitId: 'v2', extract: false });

  await browser.reportPageContent(TAB, url, { kind: 'scroll', depth: 1 }, firstDocument);
  expect(recorder.getCurrentVisit(TAB)?.scrollDepth).toBe(0);
  await browser.reportPageContent(TAB, url, { kind: 'scroll', depth: 0.5 }, secondDocument);
  expect(recorder.getCurrentVisit(TAB)?.scrollDepth).toBe(0.5);
});
