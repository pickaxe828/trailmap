import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import type { ChatSite } from './chat-sites';
import { CHAT_SURFACES } from './chat-extract';

const site = new URL('../../../../e2e/site/chat/', import.meta.url);
const hosts: Record<ChatSite, string> = { chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai', gemini: 'https://gemini.google.com' };
const paths: Record<ChatSite, string> = { chatgpt: '/c/1', claude: '/chat/1', gemini: '/app/1' };
const FIRST = 'Why is the sky blue?';
const NEXT = 'What is Rayleigh scattering?';

async function load(name: ChatSite) {
  const dom = new JSDOM(await Bun.file(new URL(`${name}.html`, site)).text(), { url: hosts[name] + paths[name] });
  // JSDOM's own script runner misbehaves under Bun, so run the fixture driver against its window directly.
  new Function('window', 'document', 'location', await Bun.file(new URL('driver.js', site)).text())(dom.window, dom.window.document, dom.window.location);
  // The extractors use the DOM classes as globals, as they are in a content script.
  Object.assign(globalThis, { Node: dom.window.Node, Element: dom.window.Element, HTMLFormElement: dom.window.HTMLFormElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement });
  const chat = (dom.window as unknown as { fixtureChat: { addTurn(q: string, o?: { streamMs?: number; reply?: unknown }): (() => void) | undefined } }).fixtureChat;
  return { document: dom.window.document, chat, window: dom.window };
}

describe.each(['chatgpt', 'claude', 'gemini'] as const)('%s extractor', (name) => {
  const surface = CHAT_SURFACES[name];

  test('reads the complete reply to the typed question, its inline source and nothing else', async () => {
    const { document, chat } = await load(name);
    const before = surface.boundaries(document);
    chat.addTurn(FIRST, { streamMs: -1 })!();
    expect(surface.find(document, FIRST, before)).toMatchObject({ result: {
      answer: 'Molecules scatter blue light more than red light.\nRead this source',
      citations: ['https://science.test/light.html'],
    } });
    const text = JSON.stringify(surface.find(document, FIRST, before));
    expect(text).not.toMatch(/Hidden scratch|Sources side panel|Sidebar result|Copy code|Earlier answer/);
  });

  test('never captures the history already in the page, even for an identical question', async () => {
    const { document, chat } = await load(name);
    const before = surface.boundaries(document);
    expect(before.size).toBe(1); // The earlier turn.
    expect(surface.find(document, 'Earlier question about tides', before)).toBeUndefined();
    // The same question typed again claims only the new reply, not the old one.
    chat.addTurn('Earlier question about tides', { streamMs: -1, reply: { answer: 'A fresh reply.' } })!();
    expect(surface.find(document, 'Earlier question about tides', before)).toMatchObject({ result: { answer: 'A fresh reply.' } });
    expect(surface.find(document, 'Earlier question about tides', new Set())).toBeUndefined(); // Ambiguous without the snapshot.
  });

  test('waits for a streaming reply to finish', async () => {
    const { document, chat } = await load(name);
    const before = surface.boundaries(document);
    const finish = chat.addTurn(NEXT, { streamMs: -1 })!;
    expect(surface.find(document, NEXT, before)).toBeUndefined();
    finish();
    expect(surface.find(document, NEXT, before)?.result?.answer).toContain('Rayleigh scattering explains');
  });

  test('an unrecognizable reply layout yields no capture instead of a wrong one', async () => {
    const { document, chat } = await load(name);
    const before = surface.boundaries(document);
    chat.addTurn('Where did the answer go?');
    expect(surface.find(document, 'Where did the answer go?', before)).toBeUndefined();
    expect(surface.find(document, 'A question nobody asked', before)).toBeUndefined();
    expect(JSON.stringify(surface.find(document, 'Where did the answer go?', before) ?? null)).not.toContain('layout nobody documented');
  });

  test('only a trusted-looking composer and send control belong to the page', async () => {
    const { document, window } = await load(name);
    const field = document.querySelector<HTMLElement>('[data-composer]')!;
    expect(surface.composer(field)).toBe(field);
    expect(surface.composer(field.firstElementChild)).toBe(field);
    expect(surface.composer(document.body)).toBeUndefined();
    field.textContent = 'Draft with\nlines';
    expect(surface.read(field)).toContain('Draft with');
    expect(surface.sendComposer(document, document.querySelector('[data-send]'))).toBe(field);
    expect(surface.sendComposer(document, document.body)).toBeUndefined();
    expect(window.document.querySelector('[data-send]')).toBeTruthy();
  });

  test('is active only on its own host', async () => {
    const { document } = await load(name);
    expect(surface.active(document)).toBe(true);
    const other = new JSDOM('<p></p>', { url: 'https://example.test/' }).window.document;
    expect(surface.active(other)).toBe(false);
  });
});
