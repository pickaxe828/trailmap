import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Visit } from '@trailmap/shared';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
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

function createRecorder() {
  let n = 0;
  const r = new VisitRecorder({ db, source: browser, store, now: clock.now, newId: () => `v${++n}` });
  r.start();
  return r;
}

async function visits(): Promise<Visit[]> {
  return db.visits.orderBy('startedAt').toArray();
}
const byUrl = async (url: string) => (await visits()).find((v) => v.url === url);

beforeEach(async () => {
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
  const cases: [string, NavTransitionType, NavTransitionQualifier[], string][] = [
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
