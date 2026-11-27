/** The pdf.js worker is emitted as an asset of the extension, and loaded from there: nothing comes from a CDN. */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export default workerUrl;
