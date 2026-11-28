import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { chatCaptureAllowed, recordingState, type RecordingSettings } from '../privacy/policy';
import { chatConversationSite } from './chat-sites';
import type { PageContent } from './page-messages';
import { VisitRecorder } from './recorder';
import { MemoryStateStore } from './state-store';
import { FakeBrowser, FakeClock } from './testing';

const TAB = 1;
const DOC = 'doc-1';
const HOME = 'https://chatgpt.com/';
const CHAT = 'https://chatgpt.com/c/abc';
const QUESTION = 'What is a monad?';
const turn = (id: string, question = QUESTION) => ({ kind: 'ai-submit', turnId: id, question }) as const;
const reply = (id: string, answer = 'A monad is a design pattern.'): PageContent =>
  ({ kind: 'ai-result', turnId: id, result: { answer, citations: ['https://learn.test/monads'] } });

let db: TrailmapDb;
let browser: FakeBrowser;
let recorder: VisitRecorder;
let settings: RecordingSettings;
let n: number;

beforeEach(async () => {
  settings = { paused: false, skippedHosts: [] };
  n = 0;
  db = openTrailmapDb(`trailmap-test-${crypto.randomUUID()}`);
  browser = new FakeBrowser();
  recorder = new VisitRecorder({
    db, source: browser, store: new MemoryStateStore(), now: new FakeClock().now, newId: () => `id${++n}`, screenDocuments: true,
    shouldRecord: (url) => recordingState(url, settings) === 'recording',
    shouldCaptureChat: (url) => chatCaptureAllowed(url, settings),
  });
  recorder.start();
  await recorder.ready;
});
afterEach(async () => {
  db.close();
  await db.delete();
});

const open = async (url = HOME, documentId = DOC) => {
  await browser.commit(TAB, url, { documentId });
  return browser.reportPageContent(TAB, url, { kind: 'screen', hasPassword: false }, documentId);
};
const everything = async () => JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())));
const optIn = (patch: Partial<RecordingSettings> = {}) => recorder.changeRecordingPolicy(async () => {
  settings = { ...settings, chatCapture: { chatgpt: true }, ...patch };
});

describe('chat capture is off until the user opts in', () => {
  test('with the opt-in off the page is not admitted and a typed turn leaves no trace', async () => {
    expect(await open()).toBeUndefined();
    expect(await browser.reportPageContent(TAB, HOME, turn('11111111-1111-1111-1111-111111111111'), DOC)).toBeUndefined();
    expect(await browser.reportPageContent(TAB, HOME, reply('11111111-1111-1111-1111-111111111111'), DOC)).toBeUndefined();
    expect(await browser.reportPageContent(TAB, HOME, { kind: 'text', visitId: 'x', text: 'private', textHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }, DOC)).toBeUndefined();
    for (const table of db.tables) expect(await table.count()).toBe(0);
  });

  test('opting another site in does not admit this one', async () => {
    await optIn({ chatCapture: { claude: true } });
    expect(await open()).toBeUndefined();
  });

  test('a page that was already open is admitted only after the opt-in, and earlier history stays out', async () => {
    expect(await open()).toBeUndefined();
    await optIn();
    expect(await browser.reportPageContent(TAB, HOME, { kind: 'screen', hasPassword: false }, DOC)).toEqual({ visitId: '', extract: false, aiPending: undefined });
    expect(await db.visits.count()).toBe(0); // Admission alone records nothing.
  });
});

describe('with the opt-in on', () => {
  beforeEach(async () => {
    await optIn();
  });

  test('a typed turn and its reply become one AI conversation node with a private key, not a page Visit', async () => {
    await open();
    const id = '22222222-2222-2222-2222-222222222222';
    await browser.reportPageContent(TAB, HOME, turn(id), DOC);
    await browser.reportPageContent(TAB, HOME, reply(id), DOC);
    const [visit] = await db.visits.toArray();
    expect(await db.visits.count()).toBe(1);
    expect(visit).toMatchObject({ aiConversation: true, title: 'ChatGPT · AI-generated', parentVisitId: null, tabId: TAB });
    expect(chatConversationSite(visit!.url)).toBe('chatgpt');
    expect(chatConversationSite(visit!.canonicalUrl)).toBe('chatgpt');
    const page = await db.pages.get(visit!.canonicalUrl);
    expect(page?.aiTurns).toMatchObject([{ question: QUESTION, answer: 'A monad is a design pattern.', citations: ['https://learn.test/monads'] }]);
    expect(await db.queries.count()).toBe(0);
    expect(await everything()).not.toContain('abc'); // The chat's own URL and id are never stored.
  });

  test('page text, scroll, selections and highlights from the chat page are never recorded', async () => {
    await open(CHAT);
    const id = '33333333-3333-3333-3333-333333333333';
    await browser.reportPageContent(TAB, CHAT, turn(id), DOC);
    await browser.reportPageContent(TAB, CHAT, { kind: 'text', visitId: 'x', text: 'Whole page text', textHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }, DOC);
    await browser.reportPageContent(TAB, CHAT, { kind: 'highlight', source: 'copy', text: 'copied secret', canonicalLink: undefined }, DOC);
    await browser.reportPageContent(TAB, CHAT, { kind: 'scroll', depth: 0.9 }, DOC);
    expect(await db.highlights.count()).toBe(0);
    expect(await everything()).not.toMatch(/Whole page text|copied secret/);
    expect((await db.visits.toArray()).every(({ aiConversation }) => aiConversation)).toBe(true);
  });

  test('a new chat moving to its own URL stays one conversation; another chat starts a new one', async () => {
    await open();
    await browser.reportPageContent(TAB, HOME, turn('44444444-4444-4444-4444-444444444444'), DOC);
    await browser.pushState(TAB, CHAT, { documentId: DOC });
    await browser.reportPageContent(TAB, CHAT, { kind: 'screen', hasPassword: false }, DOC);
    await browser.reportPageContent(TAB, CHAT, reply('44444444-4444-4444-4444-444444444444'), DOC);
    expect(await db.visits.count()).toBe(1);
    await browser.pushState(TAB, 'https://chatgpt.com/c/other', { documentId: DOC });
    await browser.reportPageContent(TAB, 'https://chatgpt.com/c/other', { kind: 'screen', hasPassword: false }, DOC);
    await browser.reportPageContent(TAB, 'https://chatgpt.com/c/other', turn('55555555-5555-5555-5555-555555555555', 'Next topic'), DOC);
    expect(await db.visits.count()).toBe(2);
  });

  test('turning the opt-in off ends the conversation, drops later turns, and the policy stops allowing sources', async () => {
    await open();
    await browser.reportPageContent(TAB, HOME, turn('66666666-6666-6666-6666-666666666666'), DOC);
    await recorder.changeRecordingPolicy(async () => { settings = { ...settings, chatCapture: {} }; });
    expect(await browser.reportPageContent(TAB, HOME, reply('66666666-6666-6666-6666-666666666666'), DOC)).toBeUndefined();
    expect(await browser.reportPageContent(TAB, HOME, turn('77777777-7777-7777-7777-777777777777'), DOC)).toBeUndefined();
    expect((await db.pages.toArray()).flatMap(({ aiTurns }) => aiTurns ?? [])).toMatchObject([{ answer: null }]);
    expect(recorder.getCurrentVisit(TAB)).toBeUndefined();
  });

  test('pausing and the skip list stop capture the same way', async () => {
    await open();
    await recorder.changeRecordingPolicy(async () => { settings = { ...settings, paused: true }; });
    expect(await browser.reportPageContent(TAB, HOME, turn('88888888-8888-8888-8888-888888888888'), DOC)).toBeUndefined();
    await recorder.changeRecordingPolicy(async () => { settings = { ...settings, paused: false, skippedHosts: ['chatgpt.com'] }; });
    expect(await open(HOME, 'doc-2')).toBeUndefined();
    expect(await browser.reportPageContent(TAB, HOME, turn('99999999-9999-9999-9999-999999999999'), 'doc-2')).toBeUndefined();
    expect(await db.visits.count()).toBe(0);
  });

  test('a password field on the chat page blocks it and forgets anything already captured', async () => {
    await open();
    await browser.reportPageContent(TAB, HOME, turn('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), DOC);
    expect(await db.visits.count()).toBe(1);
    await browser.reportPageContent(TAB, HOME, { kind: 'screen', hasPassword: true }, DOC);
    expect(await db.visits.count()).toBe(0);
    expect(await db.pages.count()).toBe(0);
    expect(await browser.reportPageContent(TAB, HOME, turn('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), DOC)).toBeUndefined();
  });

  test('a reply that could not be read keeps only the question', async () => {
    await open();
    const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    await browser.reportPageContent(TAB, HOME, turn(id), DOC);
    await browser.reportPageContent(TAB, HOME, { kind: 'ai-result', turnId: id, result: null }, DOC);
    expect((await db.pages.toArray())[0]?.aiTurns).toMatchObject([{ question: QUESTION, answer: null, extractionFailed: true }]);
  });
});
