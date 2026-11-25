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

Bun.serve({
  port: FIXTURE_PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const relative = normalize(pathname === '/' ? '/index.html' : pathname);
    if (relative.includes('..')) return new Response('Bad path', { status: 400 });
    const file = Bun.file(join(root, relative));
    return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
  },
});

console.log(`fixture server listening on http://127.0.0.1:${FIXTURE_PORT}`);
