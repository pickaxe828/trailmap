import { capPageText } from './page-text';
import { PAGE_TEXT_BYTE_LIMIT } from './page-messages';

/** A PDF larger than this is never re-fetched or parsed (the cap also bounds the memory the parser can use). */
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_FETCH_TIMEOUT_MS = 30_000;
/** Page text is capped at about 12 KB, so a long PDF never needs more than its first pages. */
export const PDF_MAX_PAGES = 60;

/** The Page text of a PDF. `text: ''` means no text layer (a scan): only the title is kept. */
export type PdfText = { text: string; textHash: string };

/** The part of pdf.js that Trailmap uses, so tests and each browser can supply their own build. */
export type PdfjsLike = {
  getDocument(source: { data: Uint8Array; isEvalSupported: boolean; verbosity: number }): {
    promise: Promise<{
      numPages: number;
      getPage(number: number): Promise<{ getTextContent(): Promise<{ items: ({ str?: string } | object)[] }>; cleanup(): void }>;
    }>;
    destroy(): Promise<void>;
  };
};

/**
 * Chromium's viewer leaves the top-level document as an application/pdf wrapper: content scripts run there (the
 * viewer itself is a cross-origin frame we can't read), and this is how a PDF without a `.pdf` URL is recognised.
 * Gecko's viewer is a privileged page that runs no content scripts, so there a PDF is only known by its URL.
 */
export const isPdfDocument = (document: { contentType: string }) => document.contentType === 'application/pdf';

/** A path ending in `.pdf`. The background checks the file's `%PDF-` header before trusting this. */
export const isPdfUrl = (url: string) => /\.pdf$/i.test(URL.parse(url)?.pathname ?? '');

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const hasHeader = (bytes: Uint8Array) => bytes.length > 8 && MAGIC.every((byte, index) => bytes[index] === byte);

/**
 * Re-fetches the viewer's own URL, with the profile's cookies: the viewer's document can't be read (Chromium's is
 * a cross-origin frame, Gecko's is a privileged page). Returns null for anything that is not a complete PDF
 * under the size cap, including a redirect to another origin.
 */
export async function fetchPdfBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array | null> {
  const signal = AbortSignal.timeout(PDF_FETCH_TIMEOUT_MS);
  const response = await fetchImpl(url, { credentials: 'include', redirect: 'follow', referrerPolicy: 'no-referrer', signal });
  try {
    if (!response.ok || !response.body || (response.url && new URL(response.url).origin !== new URL(url).origin)) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > PDF_MAX_BYTES) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > PDF_MAX_BYTES) return null;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return hasHeader(bytes) ? bytes : null;
  } finally {
    // Stops an over-cap or rejected download instead of letting it run on.
    await response.body?.cancel().catch(() => {});
  }
}

const encoder = new TextEncoder();

/** The text layer, page by page, until the Page text cap is reached. Never renders anything. */
export async function extractPdfText(bytes: Uint8Array, pdfjs: PdfjsLike): Promise<PdfText> {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
  try {
    const document = await task.promise;
    let text = '';
    for (let number = 1; number <= Math.min(document.numPages, PDF_MAX_PAGES); number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      page.cleanup();
      const pageText = content.items.map((item) => ('str' in item && typeof item.str === 'string' ? item.str : '')).join(' ');
      text = `${text} ${pageText}`.replace(/\s+/gu, ' ').trim();
      if (encoder.encode(text).length >= PAGE_TEXT_BYTE_LIMIT) break;
    }
    return text ? capPageText(text) : { text: '', textHash: '' };
  } finally {
    await task.destroy();
  }
}

/** Fetch and parse a PDF. Null when it could not be read (too large, not a PDF, offline, corrupt). */
export async function readPdf(url: string, deps: { fetch?: typeof fetch; pdfjs: PdfjsLike }): Promise<PdfText | null> {
  try {
    const bytes = await fetchPdfBytes(url, deps.fetch);
    return bytes && await extractPdfText(bytes, deps.pdfjs);
  } catch {
    return null;
  }
}
