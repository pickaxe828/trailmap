import { isPdfText, READ_PDF_MESSAGE, type ReadPdfReply } from '../capture/pdf-messages';
import type { PdfText } from '../capture/pdf';
import { isFirefox } from './browser';
import { ensureOffscreen } from './embeddings';

const READ_TIMEOUT_MS = 60_000;
/** A freshly created offscreen document registers its listener a moment after `createDocument` resolves. */
const LISTENER_RETRY_MS = 150;

async function askOffscreen(url: string, until: number): Promise<ReadPdfReply | undefined> {
  for (;;) {
    try {
      return await chrome.runtime.sendMessage({ type: READ_PDF_MESSAGE, url });
    } catch (error) {
      if (!/Receiving end does not exist/i.test(String(error)) || Date.now() + LISTENER_RETRY_MS > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, LISTENER_RETRY_MS));
    }
  }
}

/** Fetches and parses a PDF where this browser can run pdf.js (Gecko's background page, Chromium's offscreen document). */
export async function readPdfOnPlatform(url: string): Promise<PdfText | null> {
  if (isFirefox) {
    const [runtime, worker] = await Promise.all([import('../capture/pdf-runtime'), import('../capture/pdf-worker-url')]);
    runtime.usePdfWorker(worker.default);
    return runtime.readPdfLocally(url);
  }
  await ensureOffscreen();
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, READ_TIMEOUT_MS));
  const reply = await Promise.race([askOffscreen(url, Date.now() + READ_TIMEOUT_MS), timeout]);
  return reply?.ok && (reply.result === null || isPdfText(reply.result)) ? reply.result : null;
}
