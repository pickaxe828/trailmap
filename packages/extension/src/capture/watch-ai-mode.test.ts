import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { AiSurface } from './ai-surface';
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
