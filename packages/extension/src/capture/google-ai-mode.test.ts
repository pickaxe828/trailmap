import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { extractAiModeAnswer } from './google-ai-mode';

const mode = '/search?udm=50&q=why+is+the+sky+blue';
const question = 'Why is the sky blue?';
async function load(name: string, path: string) {
  const html = await Bun.file(new URL(`../../../../e2e/site/google/${name}.html`, import.meta.url)).text();
  return new JSDOM(html, { url: `https://www.google.com${path}` }).window.document;
}

test('extracts only the matching AI Mode reply and its inline links after a typed turn', async () => {
  const dom = await load('ai-mode', mode);
  expect(extractAiModeAnswer(dom, undefined)).toBeUndefined();
  expect(extractAiModeAnswer(dom, 'A different question')).toBeUndefined();
  expect(extractAiModeAnswer(dom, question)).toEqual({
    answer: 'Air scatters shorter wavelengths more strongly.\nBlue light is scattered in many directions.',
    citations: ['https://science.test/light.html'],
  });
});

test('reads the first answer and both follow-ups in a reduced saved conversation', async () => {
  const dom = await load('ai-mode-saved', '/search?udm=50&q=how+did+myoglobin+evolve');
  expect(['how did myoglobin evolve', 'How about heme?', 'vitamin B12'].map((q) => extractAiModeAnswer(dom, q))).toEqual([
    { answer: 'Myoglobin evolved from ancestral globins and helps store oxygen in muscle.\nDiving mammals\nHigh concentrations of myoglobin help whales and seals stay submerged.', citations: ['https://science.test/globins'] },
    { answer: 'Heme is the iron-containing group that lets myoglobin bind oxygen.\nHeme contains iron.', citations: [] },
    { answer: 'Vitamin B12 contains cobalt, unlike the iron in heme.\nA shared origin\nBoth come from ancient pathways that build ring-shaped molecules.', citations: [] },
  ]);
});

test('a streaming or ambiguous reply does not answer the question', async () => {
  const dom = await load('ai-mode-saved', mode);
  const question = 'How about heme?';
  const reply = dom.querySelector('.Zkbeff')!;
  reply.setAttribute('data-complete', 'false');
  expect(extractAiModeAnswer(dom, question)).toBeUndefined();
  reply.setAttribute('data-complete', 'true');
  reply.after(reply.cloneNode(true));
  expect(extractAiModeAnswer(dom, question)).toBeUndefined();
});

test('ordinary Google results cannot supply a reply even if the search was typed', async () => {
  const dom = await load('ai-overview', '/search?q=why+is+the+sky+blue');
  expect(extractAiModeAnswer(dom, question)).toBeUndefined();
});
