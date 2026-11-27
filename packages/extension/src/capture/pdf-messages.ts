import type { PdfText } from './pdf';

/** Background to offscreen document (Chromium): read the PDF at this URL. Gecko reads it in the background page. */
export const READ_PDF_MESSAGE = 'trailmap.readPdf';

export type ReadPdfReply = { ok: true; result: PdfText | null } | { ok: false };

export const isPdfText = (value: unknown): value is PdfText => {
  if (typeof value !== 'object' || value === null) return false;
  const { text, textHash } = value as Partial<PdfText>;
  return typeof text === 'string' && typeof textHash === 'string' && (text === '' ? textHash === '' : /^[0-9a-f]{64}$/.test(textHash));
};
