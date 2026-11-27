/**
 * pdf.js, bundled: the library and its worker both ship inside the extension (no CDN). Imported only by the
 * offscreen document (Chromium) and, lazily, by the Gecko background page: both are documents that can start a
 * worker. A Chromium service worker cannot, which is why this does not run in the background there.
 */
import * as pdfjs from 'pdfjs-dist';
import { readPdf, type PdfText } from './pdf';
import { READ_PDF_MESSAGE, type ReadPdfReply } from './pdf-messages';

/** `workerUrl` is the extension-relative path of the bundled pdf.js worker (see `pdf-worker-url.ts`). */
export function usePdfWorker(workerUrl: string) {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(workerUrl);
}

export const readPdfLocally = (url: string): Promise<PdfText | null> => readPdf(url, { pdfjs });

/** The offscreen side of `platform/pdf.ts`. Only the extension's own background page may ask. */
export function serveReadPdfRequests() {
  chrome.runtime.onMessage.addListener((message, sender, respond: (reply: ReadPdfReply) => void) => {
    if (message?.type !== READ_PDF_MESSAGE || sender.id !== chrome.runtime.id || sender.tab ||
        sender.url !== chrome.runtime.getURL('background.js')) return;
    const url: unknown = message.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    void readPdfLocally(url).then((result) => respond({ ok: true, result }), () => respond({ ok: false }));
    return true;
  });
}
