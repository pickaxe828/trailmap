/**
 * Local fixture site for E2E, run as a separate Bun process by Playwright's
 * `webServer` option (see playwright.config.ts).
 *
 * It serves every file under ./site on one port, whatever hostname the request
 * used. Tests reach it as http://learn.test:<port>/ etc. because Chromium is
 * launched with --host-resolver-rules mapping *.test to 127.0.0.1.
 */
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_PORT } from './constants';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'site');

/** Who asked for each PDF (so a test can tell the viewer's own request from the extension's re-fetch). */
const pdfRequests: { path: string; accept: string | null; cookie: boolean }[] = [];

Bun.serve({
  port: FIXTURE_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/__pdf-requests') return Response.json(pdfRequests);
    if (pathname.endsWith('.pdf') || pathname === '/pdf/download') {
      const cookie = /(?:^|; )session=ok(?:;|$)/.test(req.headers.get('cookie') ?? '');
      pdfRequests.push({ path: pathname, accept: req.headers.get('accept'), cookie });
      if (pathname === '/pdf/private.pdf' && !cookie) return new Response('Sign in', { status: 401 });
    }
    // A PDF with no .pdf in its URL, known only by its content type.
    if (pathname === '/pdf/download') return new Response(Bun.file(join(root, 'pdf/paper.pdf')), { headers: { 'content-type': 'application/pdf' } });
    const relative = normalize(pathname === '/' ? '/index.html' : pathname);
    if (relative.includes('..')) return new Response('Bad path', { status: 400 });
    const file = Bun.file(join(root, relative));
    return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
  },
});

console.log(`fixture server listening on http://127.0.0.1:${FIXTURE_PORT}`);
