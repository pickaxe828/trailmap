import { afterEach, beforeEach, expect, test } from 'bun:test';
import { forgetCascade } from '../corrections/forget';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { recordingState, type RecordingSettings } from '../privacy/policy';
import { VisitRecorder } from './recorder';
import { MemoryStateStore } from './state-store';
import { FakeBrowser, FakeClock } from './testing';

const TAB = 1;
const DOC = 'doc-1';
const VIDEO = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const TITLE_AND_DESCRIPTION = 'LSM trees A walkthrough of memtables and compaction.';
const text = (visitId: string) => ({ kind: 'text', visitId, text: TITLE_AND_DESCRIPTION, textHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }) as const;

let db: TrailmapDb;
let browser: FakeBrowser;
let clock: FakeClock;
let settings: RecordingSettings;
let recorder: VisitRecorder;
let n: number;

beforeEach(async () => {
  settings = { paused: false, skippedHosts: [] };
  n = 0;
  clock = new FakeClock();
  db = openTrailmapDb(`trailmap-test-${crypto.randomUUID()}`);
  browser = new FakeBrowser();
  recorder = new VisitRecorder({
    db, source: browser, store: new MemoryStateStore(), now: clock.now, newId: () => `id${++n}`,
    shouldRecord: (url) => recordingState(url, settings) === 'recording',
  });
  recorder.start();
  await recorder.ready;
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const open = async (url = VIDEO) => {
  await browser.commit(TAB, url, { documentId: DOC });
  return (await browser.reportPageContent(TAB, url, { kind: 'probe', sourceHash: 'b'.repeat(64) }, DOC))!;
};
const visit = async () => (await db.visits.toArray())[0]!;
const everything = async () => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));

test('an admitted watch page stores its title and description as Page text', async () => {
  const { visitId, extract } = await open();
  expect(extract).toBe(true);
  await browser.reportPageContent(TAB, VIDEO, text(visitId), DOC);
  expect(await db.pages.toArray()).toMatchObject([{ canonicalUrl: VIDEO, text: TITLE_AND_DESCRIPTION }]);
});

test('watch time, not scroll depth or tab time, drives a video Visit\'s engagement', async () => {
  const { visitId } = await open();
  await browser.reportPageContent(TAB, VIDEO, text(visitId), DOC);
  await browser.reportPageContent(TAB, VIDEO, { kind: 'scroll', depth: 1 }, DOC);
  expect(await visit()).toMatchObject({ engagement: 'bounced' });

  await browser.reportPageContent(TAB, VIDEO, { kind: 'watch', watchMs: 12_000 }, DOC);
  expect(await visit()).toMatchObject({ engagement: 'skimmed', watchMs: 12_000 });

  await browser.reportPageContent(TAB, VIDEO, { kind: 'watch', watchMs: 5_000 }, DOC); // Never goes backwards.
  expect(await visit()).toMatchObject({ watchMs: 12_000 });

  await browser.reportPageContent(TAB, VIDEO, { kind: 'watch', watchMs: 45_000 }, DOC);
  expect(await visit()).toMatchObject({ engagement: 'read', watchMs: 45_000 });
});

test('an open tab with the video paused (active time only) stays bounced', async () => {
  await open();
  await browser.focusWindow(1);
  await browser.activateTab(TAB, 1);
  clock.advance(10 * 60_000);
  await browser.tick();
  expect(await visit()).toMatchObject({ activeMs: 600_000, engagement: 'bounced' });
});

test('watch time on an ordinary page is ignored', async () => {
  const url = 'https://learn.test/article';
  await browser.commit(TAB, url, { documentId: DOC });
  await browser.reportPageContent(TAB, url, { kind: 'watch', watchMs: 120_000 }, DOC);
  expect(await visit()).toMatchObject({ engagement: 'bounced' });
  expect((await visit()).watchMs).toBeUndefined();
});

test('watch time from a document that is no longer the tab\'s is ignored', async () => {
  await open();
  await browser.reportPageContent(TAB, VIDEO, { kind: 'watch', watchMs: 60_000 }, 'old-document');
  expect(await visit()).toMatchObject({ engagement: 'bounced' });
});

test('paused recording or a skipped site stores no video description and no watch time', async () => {
  const { visitId } = await open();
  await recorder.changeRecordingPolicy(async () => { settings = { ...settings, paused: true }; });
  await browser.reportPageContent(TAB, VIDEO, text(visitId), DOC);
  await browser.reportPageContent(TAB, VIDEO, { kind: 'watch', watchMs: 60_000 }, DOC);
  expect(await everything()).not.toContain('memtable');
  expect(await db.pages.count()).toBe(0);
  expect((await db.visits.toArray()).every((row) => !row.watchMs)).toBe(true);

  await recorder.changeRecordingPolicy(async () => { settings = { paused: false, skippedHosts: ['youtube.com'] }; });
  expect(await browser.reportPageContent(TAB, VIDEO, { kind: 'probe', sourceHash: 'b'.repeat(64) }, DOC)).toBeUndefined();
  expect(await db.pages.count()).toBe(0);
});

test('a skipped site is never admitted, so the content script has nothing to read or fetch', async () => {
  settings = { paused: false, skippedHosts: ['www.youtube.com'] };
  await browser.commit(TAB, VIDEO, { documentId: DOC });
  expect(await browser.reportPageContent(TAB, VIDEO, { kind: 'probe', sourceHash: 'b'.repeat(64) }, DOC)).toBeUndefined();
  expect(await db.visits.count()).toBe(0);
});

test('forgetting the Visit removes the video description from every table', async () => {
  const { visitId } = await open();
  await browser.reportPageContent(TAB, VIDEO, text(visitId), DOC);
  await browser.reportPageContent(TAB, VIDEO, { kind: 'watch', watchMs: 50_000 }, DOC);
  expect(await everything()).toContain('memtable');
  await forgetCascade(db, { kind: 'forget-page', visitIds: [visitId], now: clock.now, newId: () => `f${++n}` });
  expect(await everything()).not.toContain('memtable');
  expect(await db.visits.count()).toBe(0);
});
