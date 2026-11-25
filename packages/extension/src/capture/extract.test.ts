import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { extractPageText } from './extract';

const fixture = new URL('../../../../e2e/site/article.html', import.meta.url);

test('extracts and hashes a capped article without changing the live document', async () => {
  const { window } = new JSDOM(await Bun.file(fixture).text(), { url: 'https://learn.test/article' });
  const { document } = window;
  const article = document.querySelector('article')!;
  const paragraph = article.querySelector('p')!;
  for (let index = 0; index < 450; index++) article.append(paragraph.cloneNode(true));
  article.append('Immediately after the text cap.');

  const result = extractPageText(document);
  expect(result?.text).toContain('Tombstones mark deleted items.');
  expect(result?.text).not.toContain('Immediately after the text cap.');
  expect(new TextEncoder().encode(result?.text).length).toBeGreaterThan(11_000);
  expect(new TextEncoder().encode(result?.text).length).toBeLessThanOrEqual(12_000);
  expect(result?.textHash).toBe(new Bun.CryptoHasher('sha256').update(result!.text).digest('hex'));
  expect(article.textContent).toContain('Immediately after the text cap.');
});

test('a password field anywhere in the document prevents extraction', async () => {
  const { window } = new JSDOM(await Bun.file(fixture).text());
  window.document.body.insertAdjacentHTML('beforeend', '<form><input type="PASSWORD"></form>');
  expect(extractPageText(window.document)).toBeNull();
});
