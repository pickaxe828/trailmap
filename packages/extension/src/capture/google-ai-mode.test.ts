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

test('ordinary Google results cannot supply a reply even if the search was typed', async () => {
  const dom = await load('ai-overview', '/search?q=why+is+the+sky+blue');
  expect(extractAiModeAnswer(dom, question)).toBeUndefined();
});
