import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { AiSurface } from './ai-surface';
import { googleAiModeSurface } from './google-ai-mode';
import type { AiCapture } from './page-messages';
import { watchAiConversation } from './watch-ai-mode';

const html = '<main><div id="reply"></div></main><textarea id="composer"></textarea><button id="send">Send</button>';

function setup({ busy = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://chatgpt.com/' });
  Object.assign(globalThis, { MutationObserver: dom.window.MutationObserver, Element: dom.window.Element, HTMLFormElement: dom.window.HTMLFormElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
  const { document } = dom.window;
  const composer = document.querySelector<HTMLTextAreaElement>('#composer')!;
  const reads: string[] = [];
  const surface: AiSurface = {
    active: () => true,
    composer: (target) => target === composer ? composer : undefined,
    formComposer: () => undefined,
    sendComposer: (_, target) => (target as Element | null)?.id === 'send' ? composer : undefined,
    read: (field) => { reads.push((field as HTMLTextAreaElement).value); return (field as HTMLTextAreaElement).value; },
    boundaries: () => new Set(),
    find: () => undefined,
    busy: () => busy,
  };
  const sent: AiCapture[] = [];
  let publicNow = false;
  const watcher = watchAiConversation(document, surface, () => publicNow, async (message) => {
    sent.push(message);
    return { visitId: '', extract: false };
  }, { trusted: () => true });
  const type = (text: string) => {
    composer.value = text;
    composer.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const enter = () => composer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { watcher, sent, reads, type, enter, composer, document, click: () => document.querySelector('#send')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
    open: () => { publicNow = true; }, close: () => { publicNow = false; } };
}

async function savedConversation() {
  const markup = await Bun.file(new URL('../../../../e2e/site/google/ai-mode-saved.html', import.meta.url)).text();
  const { window } = new JSDOM(markup, { url: 'https://www.google.com/search?udm=50' });
  Object.assign(globalThis, { Element: window.Element, MutationObserver: window.MutationObserver });
  const { document } = window;
  document.addEventListener('click', (event) => event.preventDefault()); // Keep test links local.
  let admitted = false;
  const userClicks = new WeakSet<Event>();
  const sent: AiCapture[] = [];
  const watcher = watchAiConversation(document, googleAiModeSurface, () => admitted, async (message) => {
    sent.push(message);
    return undefined;
  }, { trusted: (event) => userClicks.has(event) });
  const click = (selector: string, trusted = true) => {
    const event = new window.MouseEvent('click', { bubbles: true });
    if (trusted) userClicks.add(event);
    document.querySelector(selector)!.dispatchEvent(event);
  };
  return { watcher, sent, click, admit: () => { admitted = true; } };
}

const suggestion = '[role="link"] strong';

test('a trusted click on a suggested follow-up submits its label without typing', async () => {
  const page = await savedConversation();
  page.admit();
  page.click(suggestion);
  expect(page.sent).toMatchObject([{ kind: 'ai-submit', question: 'vitamin B12' }]);
  page.watcher.dispose();
});

test('suggestion clicks before admission or untrusted clicks are not recorded; citations and links never start turns', async () => {
  const page = await savedConversation();
  page.click(suggestion);
  page.admit();
  page.click(suggestion, false);
  page.click('a.PMDqCb');
  page.click('[aria-label="Related results"]');
  page.click('a.c0nryc');
  expect(page.sent).toEqual([]);
  page.watcher.dispose();
});

describe('conversation watching only starts after the document is admitted', () => {
  test('an unadmitted document never has its composer read, so a draft or send is invisible', () => {
    const page = setup();
    page.type('Something private I typed');
    page.enter();
    page.click();
    expect(page.reads).toEqual([]);
    expect(page.sent).toEqual([]);
  });

  test('text typed before admission is never captured, even if the document is admitted before it is sent', () => {
    const page = setup();
    page.type('Typed while the site was still opted out');
    page.open(); // The user opts in while the page is open.
    page.enter();
    expect(page.sent).toEqual([]);
  });

  test('a turn typed after admission is captured exactly once however it is submitted', async () => {
    const page = setup();
    page.open();
    page.type('What is a monad?');
    page.enter();
    page.click();
    await Promise.resolve();
    expect(page.sent).toMatchObject([{ kind: 'ai-submit', question: 'What is a monad?' }]);
  });

  test('closing admission stops capture and forgets pending turns', async () => {
    const page = setup();
    page.open();
    page.type('First question');
    page.enter();
    await Promise.resolve();
    page.watcher.clear();
    page.close();
    page.type('Second question');
    page.enter();
    expect(page.sent).toHaveLength(1);
  });

  test('a busy reply does not turn an ignored Enter into a captured turn', () => {
    const page = setup({ busy: true });
    page.open();
    page.type('typed while the reply is still streaming');
    page.enter();
    expect(page.sent).toEqual([]);
  });
});
