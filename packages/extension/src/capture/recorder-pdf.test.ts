import { afterEach, beforeEach, expect, test } from 'bun:test';
import { forgetCascade } from '../corrections/forget';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { recordingState, type RecordingSettings } from '../privacy/policy';
import type { PdfText } from './pdf';
import { VisitRecorder } from './recorder';
import { MemoryStateStore } from './state-store';
import { FakeBrowser, FakeClock } from './testing';

const TAB = 1;
const DOC = 'doc-1';
const PDF = 'https://papers.test/lsm.pdf';
const TEXT = 'Log-structured merge trees buffer writes in a memtable.';
const HASH = 'a'.repeat(64);
const DOM = 'b'.repeat(64);
const probe = { kind: 'probe', sourceHash: DOM, pdf: true } as const;

let db: TrailmapDb;
let browser: FakeBrowser;
let clock: FakeClock;
let settings: RecordingSettings;
let recorder: VisitRecorder;
let reads: string[];
let result: () => Promise<PdfText | null>;
let incognito: boolean;
let n: number;

const makeRecorder = (extra: Partial<ConstructorParameters<typeof VisitRecorder>[0]> = {}) => new VisitRecorder({
  db, source: browser, store: new MemoryStateStore(), now: clock.now, newId: () => `id${++n}`,
  shouldRecord: (url) => recordingState(url, settings) === 'recording',
  readPdf: async (url) => {
    reads.push(url);
    return result();
  },
  isIncognitoTab: async () => incognito,
  ...extra,
});

beforeEach(async () => {
  settings = { paused: false, skippedHosts: [] };
  n = 0;
  reads = [];
  result = async () => ({ text: TEXT, textHash: HASH });
  clock = new FakeClock();
  db = openTrailmapDb(`trailmap-test-${crypto.randomUUID()}`);
  browser = new FakeBrowser();
  incognito = false;
  recorder = makeRecorder();
  recorder.start();
  await recorder.ready;
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const open = async (url = PDF, content: Parameters<FakeBrowser['reportPageContent']>[2] = probe) => {
  await browser.commit(TAB, url, { documentId: DOC });
  return (await browser.reportPageContent(TAB, url, content, DOC))!;
};
const settled = () => recorder.pdfReadsIdle();
const visit = async () => (await db.visits.toArray())[0]!;
const everything = async () => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));

test('a PDF Visit has its text layer stored as the Page text and queued for enrichment, read once', async () => {
  const reply = await open(`${PDF}#page=3`);
  expect(reply.extract).toBe(false); // The background reads it; the content script has no text to send.
  await settled();
  expect(reads).toEqual([PDF]); // The fragment is not part of the request.
  expect(await visit()).toMatchObject({ pdf: true });
  expect(await db.pages.toArray()).toMatchObject([{ canonicalUrl: PDF, text: TEXT, textHash: HASH, sourceUrl: PDF, sourceHash: DOM }]);
  expect(await db.jobs.count()).toBe(0); // Still bounced: enrichment waits until the PDF is skimmed.
  await browser.focusWindow(1);
  await browser.activateTab(TAB, 1);
  clock.advance(12_000);
  await browser.tick();
  expect(await db.jobs.toArray()).toMatchObject([{ kind: 'page_enrichment', payload: { canonicalUrl: PDF } }]);

  expect((await browser.reportPageContent(TAB, PDF, probe, DOC))!.extract).toBe(false);
  await settled();
  expect(reads).toHaveLength(1); // The same PDF is not fetched again on the next probe.
});

test('a scanned PDF keeps only its title: an empty Page, no enrichment job, and no re-fetch', async () => {
  result = async () => ({ text: '', textHash: '' });
  await open();
  await browser.setTitle(TAB, PDF, 'Scanned lecture notes');
  await settled();
  await browser.focusWindow(1);
  await browser.activateTab(TAB, 1);
  clock.advance(60_000);
  await browser.tick();
  expect(await db.pages.toArray()).toMatchObject([{ canonicalUrl: PDF, text: '', sourceUrl: PDF }]);
  expect(await visit()).toMatchObject({ title: 'Scanned lecture notes' });
  expect(await db.jobs.count()).toBe(0);
  await browser.reportPageContent(TAB, PDF, probe, DOC);
  await settled();
  expect(reads).toHaveLength(1);
});

test('a PDF that could not be read (too large, offline, corrupt) leaves no Page, and the next probe tries again', async () => {
  result = async () => null;
  await open();
  await settled();
  expect(await db.pages.count()).toBe(0);
  result = async () => ({ text: TEXT, textHash: HASH });
  await browser.reportPageContent(TAB, PDF, probe, DOC);
  await settled();
  expect(await db.pages.count()).toBe(1);
});

test('an incognito tab is never re-fetched: the request would carry the normal profile\'s cookies', async () => {
  await browser.commit(TAB, PDF, { documentId: DOC });
  incognito = true;
  await browser.reportPageContent(TAB, PDF, probe, DOC);
  await settled();
  expect(reads).toEqual([]);
  expect(await db.pages.count()).toBe(0);
});

test('a PDF that is not on a page the content script screened as a PDF is never fetched', async () => {
  const url = 'https://learn.test/article';
  await open(url, { kind: 'probe', sourceHash: DOM });
  await settled();
  expect(reads).toEqual([]);
  expect((await visit()).pdf).toBeUndefined();
});

test('paused recording or a skipped site: no Visit, so no request', async () => {
  settings = { paused: true, skippedHosts: [] };
  await browser.commit(TAB, PDF, { documentId: DOC });
  expect(await browser.reportPageContent(TAB, PDF, probe, DOC)).toBeUndefined();
  settings = { paused: false, skippedHosts: ['papers.test'] };
  expect(await browser.reportPageContent(TAB, PDF, probe, DOC)).toBeUndefined();
  await settled();
  expect(reads).toEqual([]);
  expect(await db.visits.count()).toBe(0);
});

test('a read that finishes after the user paused, skipped the site, left or forgot the Visit is thrown away', async () => {
  const scenarios: [string, () => Promise<unknown>][] = [
    ['paused', () => recorder.changeRecordingPolicy(async () => { settings = { paused: true, skippedHosts: [] }; })],
    ['skipped', () => recorder.changeRecordingPolicy(async () => { settings = { paused: false, skippedHosts: ['papers.test'] }; })],
    ['navigated', () => browser.commit(TAB, 'https://learn.test/other', { documentId: 'doc-2' })],
    ['closed', () => browser.closeTab(TAB)],
    ['forgotten', async () => forgetCascade(db, { kind: 'forget-page', visitIds: [(await visit()).id], now: clock.now, newId: () => `f${++n}` })],
  ];
  for (const [label, act] of scenarios) {
    const pending = Promise.withResolvers<PdfText | null>();
    result = () => pending.promise;
    settings = { paused: false, skippedHosts: [] };
    await browser.closeTab(TAB);
    await open();
    await act();
    pending.resolve({ text: TEXT, textHash: HASH });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settled();
    expect({ label, pages: await db.pages.count(), jobs: await db.jobs.count() }).toEqual({ label, pages: 0, jobs: 0 });
    expect(await everything()).not.toContain('memtable');
    await forgetCascade(db, { kind: 'forget-page', visitIds: (await db.visits.toArray()).map(({ id }) => id), now: clock.now, newId: () => `g${++n}` });
  }
});

test('a password page is not read', async () => {
  await browser.commit(TAB, PDF, { documentId: DOC });
  await browser.reportPageContent(TAB, PDF, { kind: 'screen', hasPassword: true }, DOC);
  expect(await browser.reportPageContent(TAB, PDF, probe, DOC)).toBeUndefined();
  await settled();
  expect(reads).toEqual([]);
});

test('time active scores a PDF Visit: neither viewer shows how far the reader got', async () => {
  await open();
  await settled();
  await browser.focusWindow(1);
  await browser.activateTab(TAB, 1);
  clock.advance(12_000);
  await browser.tick();
  expect(await visit()).toMatchObject({ engagement: 'skimmed' });
  await browser.reportPageContent(TAB, PDF, { kind: 'scroll', depth: 0.9 }, DOC); // The wrapper's own scrolling says nothing.
  expect(await visit()).toMatchObject({ engagement: 'skimmed' });
  clock.advance(40_000);
  await browser.tick();
  expect(await visit()).toMatchObject({ engagement: 'read' });
});

test('forgetting the Visit removes the PDF text from every table', async () => {
  await open();
  await settled();
  expect(await everything()).toContain('memtable');
  await forgetCascade(db, { kind: 'forget-page', visitIds: [(await visit()).id], now: clock.now, newId: () => `f${++n}` });
  expect(await everything()).not.toContain('memtable');
  expect(await db.visits.count()).toBe(0);
  expect(await db.pages.count()).toBe(0);
});

test.each([['paused', { paused: true, skippedHosts: [] }], ['skipped', { paused: false, skippedHosts: ['papers.test'] }]])(
  'Gecko: a .pdf URL is admitted at commit, with no content script, but not when %s', async (_, blocked) => {
    recorder = makeRecorder({ admitPdfUrls: true });
    recorder.start();
    await recorder.ready;
    settings = blocked;
    await browser.commit(TAB, PDF, { documentId: DOC });
    await settled();
    expect(reads).toEqual([]);
    expect(await db.visits.count()).toBe(0);
  });

test('Gecko: a .pdf URL is admitted at commit, read once without any content script, and not read again on a revisit', async () => {
  recorder = makeRecorder({ admitPdfUrls: true, screenDocuments: true });
  recorder.start();
  await recorder.ready;
  await browser.commit(TAB, `${PDF}#page=2`, { documentId: DOC });
  await settled();
  expect(reads).toEqual([PDF]);
  expect(await visit()).toMatchObject({ pdf: true, url: PDF });
  expect(await db.pages.toArray()).toMatchObject([{ canonicalUrl: PDF, text: TEXT, sourceUrl: PDF }]);

  await browser.commit(TAB, 'https://learn.test/article', { documentId: 'doc-2' });
  await browser.commit(TAB, PDF, { documentId: 'doc-3' });
  await settled();
  expect(reads).toHaveLength(1);
  expect((await db.visits.toArray()).filter(({ url }) => url === PDF)).toHaveLength(2);
});

test('Gecko: an incognito tab is not re-fetched either', async () => {
  recorder = makeRecorder({ admitPdfUrls: true });
  recorder.start();
  await recorder.ready;
  incognito = true;
  await browser.commit(TAB, PDF, { documentId: DOC });
  await settled();
  expect(reads).toEqual([]);
  expect(await db.pages.count()).toBe(0);
});

test('without that option (Chromium), a .pdf URL still waits for its screened document', async () => {
  recorder = makeRecorder({ screenDocuments: true });
  recorder = makeRecorder({ screenDocuments: true });
  recorder.start();
  await recorder.ready;
  await browser.commit(TAB, PDF, { documentId: DOC });
  await settled();
  expect(await db.visits.count()).toBe(0);
  expect(reads).toEqual([]);
});
