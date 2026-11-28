import { expect, test } from 'bun:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scannedPdf, textPdf } from '../../../../e2e/site/pdf/build-pdf';
import { PAGE_TEXT_BYTE_LIMIT } from './page-messages';
import { extractPdfText, fetchPdfBytes, isPdfDocument, isPdfUrl, PDF_MAX_BYTES, readPdf } from './pdf';

const URL_ = 'https://papers.test/lsm.pdf';
// pdf.js takes ownership of the bytes it is given (it transfers the buffer), so each use builds its own.
const paper = () => textPdf('LSM trees', [
  ['Log-structured merge trees buffer writes in a memtable.'],
  ['Compaction merges sorted runs.'],
]);

type Fetch = typeof fetch;
const respond = (body: BodyInit | Uint8Array, init: ResponseInit & { url?: string } = {}) => {
  const { url, ...rest } = init;
  const response = new Response(body as BodyInit, rest);
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
};
const fetching = (response: Response | (() => Response)): Fetch & { calls: [string, RequestInit | undefined][] } => {
  const calls: [string, RequestInit | undefined][] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push([String(input), init]);
    return typeof response === 'function' ? response() : response;
  }) as Fetch & { calls: typeof calls };
  fake.calls = calls;
  return fake;
};

test('the text layer of every page becomes the Page text, whitespace collapsed', async () => {
  const result = await extractPdfText(paper(), pdfjs);
  expect(result.text).toBe('Log-structured merge trees buffer writes in a memtable. Compaction merges sorted runs.');
  expect(result.textHash).toMatch(/^[0-9a-f]{64}$/);
});

test('a PDF without a text layer has no text, so only its title is kept', async () => {
  expect(await extractPdfText(scannedPdf('Scanned lecture notes'), pdfjs)).toEqual({ text: '', textHash: '' });
});

test('long PDFs are capped like pages, and pages past the cap are not read', async () => {
  const line = 'The memtable is flushed to an immutable sorted run on disk. ';
  const pages = Array.from({ length: 40 }, () => Array.from({ length: 8 }, () => line));
  const result = await extractPdfText(textPdf('Long', pages), pdfjs);
  expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(PAGE_TEXT_BYTE_LIMIT);
  expect(result.text.length).toBeGreaterThan(PAGE_TEXT_BYTE_LIMIT - 200);
});

test('the same URL is re-fetched once with the cookies of the browser profile, and nothing else is sent', async () => {
  const fake = fetching(respond(paper(), { headers: { 'content-type': 'application/pdf' }, url: URL_ }));
  const bytes = await fetchPdfBytes(URL_, fake);
  expect(bytes?.length).toBe(paper().length);
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]![0]).toBe(URL_);
  expect(fake.calls[0]![1]).toMatchObject({ credentials: 'include', referrerPolicy: 'no-referrer' });
});

test('a file larger than the cap is not read: not from its length header, and not from a stream that lies', async () => {
  const declared = fetching(respond(paper(), { headers: { 'content-length': String(PDF_MAX_BYTES + 1) }, url: URL_ }));
  expect(await fetchPdfBytes(URL_, declared)).toBeNull();

  const chunk = new Uint8Array(1024 * 1024).fill(37);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += chunk.length;
      controller.enqueue(chunk);
    },
  });
  const endless = fetching(respond(body, { url: URL_ }));
  expect(await fetchPdfBytes(URL_, endless)).toBeNull();
  expect(sent).toBeLessThanOrEqual(PDF_MAX_BYTES + 4 * chunk.length);
});

test('a redirect to another origin, an error status or a non-PDF body gives nothing', async () => {
  expect(await readPdf(URL_, { fetch: fetching(respond(paper(), { url: 'https://elsewhere.test/lsm.pdf' })), pdfjs })).toBeNull();
  expect(await readPdf(URL_, { fetch: fetching(respond('nope', { status: 403, url: URL_ })), pdfjs })).toBeNull();
  expect(await readPdf(URL_, { fetch: fetching(respond('<html>sign in</html>', { url: URL_ })), pdfjs })).toBeNull();
  expect(await readPdf(URL_, { fetch: fetching(() => { throw new Error('offline'); }), pdfjs })).toBeNull();
});

test('a corrupt PDF gives nothing instead of throwing', async () => {
  expect(await readPdf(URL_, { fetch: fetching(respond('%PDF-1.4\nthis is not a pdf', { url: URL_ })), pdfjs })).toBeNull();
});

test('readPdf returns the text, or an empty result for a scan', async () => {
  expect(await readPdf(URL_, { fetch: fetching(respond(paper(), { url: URL_ })), pdfjs })).toMatchObject({ text: expect.stringContaining('memtable') });
  expect(await readPdf(URL_, { fetch: fetching(respond(scannedPdf('Scan'), { url: URL_ })), pdfjs })).toEqual({ text: '', textHash: '' });
});

test('a PDF is recognised by the wrapper document Chromium shows, or by a .pdf path', () => {
  expect(isPdfDocument({ contentType: 'application/pdf' })).toBe(true);
  expect(isPdfDocument({ contentType: 'text/html' })).toBe(false);
  expect(isPdfUrl('https://a.test/paper.PDF?dl=1#page=2')).toBe(true);
  expect(isPdfUrl('https://a.test/paper.pdf.html')).toBe(false);
  expect(isPdfUrl('https://a.test/download?file=paper.pdf')).toBe(false);
});
