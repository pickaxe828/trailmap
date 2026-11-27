/**
 * Writes the fixture PDFs next to this file: `bun e2e/site/pdf/make-fixtures.ts`.
 * `paper.pdf` has a text layer (two pages), `private.pdf` is a one-page text PDF that needs a cookie, and `scan.pdf` is
 * image-only, like a scanned lecture.
 * Hand-built (build-pdf.ts) so nothing is downloaded and the bytes are reproducible.
 */
import { scannedPdf, textPdf } from './build-pdf';

await Bun.write(new URL('./paper.pdf', import.meta.url), textPdf('LSM trees: a short paper', [
  ['Log-structured merge trees buffer writes in a memtable.', 'A flush turns the memtable into an immutable sorted run.'],
  ['Compaction merges sorted runs and discards overwritten keys.', 'Bloom filters keep point reads cheap.'],
]));
// Served only to a request that carries the session cookie (fixture-server.ts): proves the re-fetch has the user's cookies.
await Bun.write(new URL('./private.pdf', import.meta.url), textPdf('Members only notes', [
  ['Members only: a tombstone records that an item was deleted.'],
]));
await Bun.write(new URL('./scan.pdf', import.meta.url), scannedPdf('Scanned lecture notes'));
