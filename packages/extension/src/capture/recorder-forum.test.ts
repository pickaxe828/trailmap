import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { recordingState, type RecordingSettings } from '../privacy/policy';
import { VisitRecorder } from './recorder';
import { MemoryStateStore } from './state-store';
import { FakeBrowser, FakeClock } from './testing';

const TAB = 1;
const DOC = 'doc-1';
const THREAD = 'https://www.reddit.com/r/databases/comments/abc123/why_compaction/';
const FEED = 'https://www.reddit.com/r/databases/';
const HN = 'https://news.ycombinator.com/item?id=4242001';
const TEXT = 'Why compaction?\n- Size-tiered favours writes.';
const text = (visitId: string) => ({ kind: 'text', visitId, text: TEXT, textHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }) as const;
const probe = { kind: 'probe', sourceHash: 'b'.repeat(64) } as const;

let db: TrailmapDb;
let browser: FakeBrowser;
let settings: RecordingSettings;
let recorder: VisitRecorder;
let n: number;

beforeEach(async () => {
  settings = { paused: false, skippedHosts: [], redditThreads: true };
  n = 0;
  db = openTrailmapDb(`trailmap-test-${crypto.randomUUID()}`);
  browser = new FakeBrowser();
  recorder = new VisitRecorder({
    db, source: browser, store: new MemoryStateStore(), now: new FakeClock().now, newId: () => `id${++n}`, screenDocuments: true,
    shouldRecord: (url) => recordingState(url, settings) === 'recording',
  });
  recorder.start();
  await recorder.ready;
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const open = async (url: string) => {
  await browser.commit(TAB, url, { documentId: DOC });
  await browser.reportPageContent(TAB, url, { kind: 'screen', hasPassword: false }, DOC);
  return browser.reportPageContent(TAB, url, probe, DOC);
};
const everything = async () => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));

describe.each([['an opted-in Reddit thread', THREAD], ['a Hacker News item', HN]])('%s', (_name, url) => {
  test('is admitted and its text is stored as the Page text', async () => {
    const reply = (await open(url))!;
    expect(reply.extract).toBe(true);
    await browser.reportPageContent(TAB, url, text(reply.visitId), DOC);
    expect(await db.pages.toArray()).toMatchObject([{ canonicalUrl: url, text: TEXT }]);
  });

  test('stores nothing while recording is paused', async () => {
    const reply = (await open(url))!;
    await recorder.changeRecordingPolicy(async () => { settings = { ...settings, paused: true }; });
    await browser.reportPageContent(TAB, url, text(reply.visitId), DOC);
    expect(await db.pages.count()).toBe(0);
    expect(await everything()).not.toContain('Size-tiered');
  });

  test('is never admitted on a skipped site', async () => {
    settings = { ...settings, skippedHosts: [new URL(url).hostname] };
    await browser.commit(TAB, url, { documentId: DOC });
    expect(await browser.reportPageContent(TAB, url, { kind: 'screen', hasPassword: false }, DOC)).toBeUndefined();
    expect(await browser.reportPageContent(TAB, url, probe, DOC)).toBeUndefined();
    expect(await db.visits.count()).toBe(0);
  });

  test('is never admitted when its page has a password field', async () => {
    await browser.commit(TAB, url, { documentId: DOC });
    await browser.reportPageContent(TAB, url, { kind: 'screen', hasPassword: true }, DOC);
    expect(await browser.reportPageContent(TAB, url, probe, DOC)).toBeUndefined();
    expect(await db.pages.count()).toBe(0);
  });
});

describe('Reddit without the opt-in', () => {
  test('a thread page is never admitted and nothing is stored', async () => {
    settings = { ...settings, redditThreads: false };
    await browser.commit(TAB, THREAD, { documentId: DOC });
    expect(await browser.reportPageContent(TAB, THREAD, { kind: 'screen', hasPassword: false }, DOC)).toBeUndefined();
    expect(await browser.reportPageContent(TAB, THREAD, probe, DOC)).toBeUndefined();
    expect(await db.visits.count()).toBe(0);
  });

  test('a feed is not admitted even with the opt-in', async () => {
    await browser.commit(TAB, FEED, { documentId: DOC });
    expect(await browser.reportPageContent(TAB, FEED, { kind: 'screen', hasPassword: false }, DOC)).toBeUndefined();
    expect(await db.visits.count()).toBe(0);
  });
});
