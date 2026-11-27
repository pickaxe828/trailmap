/** Headless Gecko smoke test using a throwaway profile and Native Messaging directory. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { firefox } from '@playwright/test';
import { GECKO_EXTENSION_ID } from '../packages/shared/src/extension-id';

const extension = resolve('packages/extension/.output/firefox-mv3');
const companion = resolve('packages/companion/dist/trailmap-companion');
const binary = process.env.FIREFOX_BINARY ?? firefox.executablePath();
const driverBin = Bun.which('geckodriver');
assert(driverBin, 'Install geckodriver (0.36 or newer) and put it on PATH.');
assert(existsSync(binary), 'Run bunx playwright install firefox or set FIREFOX_BINARY to a Firefox/Zen executable.');
assert(existsSync(extension) && existsSync(companion), 'Run bun run build:firefox and bun run build:companion first.');

const root = mkdtempSync(join(tmpdir(), 'trailmap-gecko-'));
const profile = join(root, 'profile');
const home = join(root, 'home');
const mozilla = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Mozilla') : join(home, '.mozilla');
const xpi = join(root, 'trailmap.xpi');
const realModel = process.env.TRAILMAP_REAL_MINILM === '1';
const proofDir = process.env.PROOF_DIR;
const fixtureDir = new URL('./site/trail/', import.meta.url);
const fixture = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === '/favicon.ico') {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmKQAAAAASUVORK5CYII=';
    return new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/png' } });
  }
  if (path === '/trail/private-frame.html') {
    return new Response('<input type="password" aria-label="Password">', { headers: { 'Content-Type': 'text/html' } });
  }
  if (path === '/pdf/paper.pdf') return new Response(Bun.file(new URL('./site/pdf/paper.pdf', import.meta.url)));
  if (!['/trail/start.html', '/trail/article.html'].includes(path)) return new Response(null, { status: 404 });
  return new Response(Bun.file(new URL(path.slice('/trail/'.length), fixtureDir)));
} });
const fixtureOrigin = `http://learn.test:${fixture.port}`;
const socket = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const port = socket.port;
socket.stop(true);
const endpoint = `http://127.0.0.1:${port}`;
let driver: ReturnType<typeof Bun.spawn> | undefined;
let session: string | undefined;

async function request<T = unknown>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(endpoint + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35_000),
  });
  const { value } = await response.json() as { value: T | { error: string; message: string } };
  if (!response.ok) throw new Error(`WebDriver ${method} ${path}: ${JSON.stringify(value)}`);
  return value as T;
}

async function until<T>(label: string, probe: () => Promise<T>, check: (value: T) => boolean, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: unknown;
  do {
    try {
      last = await probe();
      if (check(last as T)) return last as T;
    } catch (error) { last = String(error); }
    await Bun.sleep(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}; last result: ${JSON.stringify(last)}`);
}

function run(args: string[], cwd?: string) {
  const proc = Bun.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  assert.equal(proc.exitCode, 0, `${args[0]} failed: ${proc.stderr.toString()}`);
}

try {
  mkdirSync(profile);
  mkdirSync(home);
  if (process.platform === 'darwin') {
    for (const dir of ['Downloads', 'Library/Application Support/Firefox']) mkdirSync(join(home, dir), { recursive: true });
  }
  run(['zip', '-q', '-r', xpi, '.'], extension);
  run([companion, 'install', '--browser', 'firefox', '--mozilla-dir', mozilla]);
  const log = Bun.file(join(root, 'geckodriver.log'));
  // Gecko requires system access for WebDriver to inspect moz-extension:// pages.
  driver = Bun.spawn([driverBin, '--host', '127.0.0.1', '--port', String(port), '--allow-system-access'], {
    stdout: log, stderr: log,
    env: { ...process.env, HOME: home, CFFIXED_USER_HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
      TRAILMAP_SECRET_STORE: 'file', TRAILMAP_COMPANION_DATA_DIR: join(root, 'companion') },
  });
  await until('geckodriver', () => request('/status'), Boolean);
  const started = await request<{ sessionId: string; capabilities: { browserVersion: string } }>('/session', { capabilities: { alwaysMatch: {
    'moz:firefoxOptions': {
      binary, args: ['-headless', '-no-remote', '-profile', profile],
      prefs: {
        'network.dns.localDomains': realModel ? 'learn.test' : 'learn.test,huggingface.co',
        'network.proxy.type': 0,
      },
    },
  } } });
  session = `/session/${started.sessionId}`;
  const call = <T = unknown>(path: string, body?: unknown) => request<T>(session + path, body);
  const execute = <T>(script: string, args: unknown[] = []) => call<T>('/execute/sync', { script, args });
  const asyncScript = <T>(script: string) => call<T>('/execute/async', { script, args: [] });
  const goto = (url: string) => call('/url', { url });
  const screenshot = async (file: string) => {
    if (!proofDir) return;
    mkdirSync(proofDir, { recursive: true });
    await Bun.write(join(proofDir, file), Buffer.from(await call<string>('/screenshot'), 'base64'));
  };

  assert.equal(await call('/moz/addon/install', { path: xpi, temporary: true }), GECKO_EXTENSION_ID);
  const onboarding = await until('onboarding tab', async () => {
    for (const handle of await call<string[]>('/window/handles')) {
      await call('/window', { handle });
      const url = await call<string>('/url');
      if (url.startsWith('moz-extension://') && url.endsWith('/onboarding.html')) return url;
    }
    return '';
  }, Boolean);
  const base = new URL('.', onboarding).href;
  const openExtensionPage = (page: string) => goto(`${base}${page}`);
  const captureTab = await call<string>('/window');
  await openExtensionPage('settings.html#companion');
  await until('companion handshake', () => execute<string>('return document.body.innerText'), (body) => body.includes('Companion connected'));
  console.log(`Gecko ${started.capabilities.browserVersion}: companion hello connected`);

  const first = `${fixtureOrigin}/trail/start.html`;
  const second = `${fixtureOrigin}/trail/article.html`;
  const { handle: fixtureTab } = await call<{ handle: string }>('/window/new', { type: 'tab' });
  await call('/window', { handle: fixtureTab });
  await goto(first);
  assert.equal(await execute('return document.title'), 'Trail start', 'fixture loaded in Gecko');
  // Read IndexedDB through extension pages, never the fixture site's origin.
  await call('/window', { handle: captureTab });
  await openExtensionPage('sidepanel.html');
  await until('Trailmap sidebar app', () => execute<string>('return document.body.innerText'), (body) => body.includes('Open expeditions'));

  const read = <T>(table: 'visits' | 'pages') => asyncScript<T[]>(`
    const done = arguments[arguments.length - 1];
    const request = indexedDB.open('trailmap');
    request.onerror = () => done([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('${table}')) { db.close(); done([]); return; }
      const rows = db.transaction('${table}').objectStore('${table}').getAll();
      rows.onsuccess = () => {
        db.close();
        // Return only JSON scalars; WebDriver cannot clone IndexedDB typed arrays.
        done(rows.result.map(({ url, id, parentVisitId, favicon, expeditionEmbedding, canonicalUrl, text, pdf, title }) =>
          ({ url, id, parentVisitId, favicon, hasEmbedding: !!expeditionEmbedding, canonicalUrl, text, pdf, title })));
      };
      rows.onerror = () => { db.close(); done([]); };
    };
  `);
  type Visit = { url: string; id: string; parentVisitId?: string; favicon?: string; hasEmbedding?: boolean; pdf?: true };
  const visits = () => read<Visit>('visits');
  const initial = await until('first Visit and favicon', visits, (rows) => rows.some((row) => row.url === first && !!row.favicon));
  await call('/window', { handle: fixtureTab });
  const link = await call<Record<string, string>>('/element', { using: 'css selector', value: '#same-tab' });
  await call(`/element/${Object.values(link)[0]}/click`, {});
  await call('/window', { handle: captureTab });
  const trail = await until('second Visit linked to the first', visits, (rows) => rows.some((row) =>
    row.url === second && row.parentVisitId === initial.find(({ url }) => url === first)?.id));
  assert.equal(trail.filter(({ url }) => url.startsWith(fixtureOrigin)).length, 2);
  await until('Page text', () => read<{ canonicalUrl: string; text: string }>('pages'),
    (rows) => rows.some(({ canonicalUrl, text }) => canonicalUrl === second && text.length > 0));
  console.log('Two linked Visits, a captured favicon, extracted Page text, and the shared sidepanel UI.');
  await screenshot('firefox-sidebar-app.png');

  const apis = await asyncScript(`
    const done = arguments[arguments.length - 1];
    const api = window.wrappedJSObject?.chrome ?? window.chrome;
    Promise.all([api.alarms.get('trailmap.capture-tick'), api.idle.queryState(60),
      api.history.search({ text: 'learn.test' }), api.storage.session.get('trailmap.companionStatus')])
      .then(([alarm, idle, history, session]) => done({
        alarm: !!alarm, idle: ['active', 'idle', 'locked'].includes(idle), history: history.length >= 2,
        session: session['trailmap.companionStatus']?.state === 'connected', omnibox: !!api.omnibox.onInputEntered,
      }), (error) => done({ error: String(error) }));
  `);
  assert.deepEqual(apis, { alarm: true, idle: true, history: true, session: true, omnibox: true });

  if (realModel) {
    await until('MiniLM vector', visits, (rows) => rows.some(({ hasEmbedding }) => hasEmbedding), 45_000);
    console.log('MiniLM produced a local Visit embedding.');
  } else {
    await openExtensionPage('settings.html#diagnostics');
    await until('embeddings fallback notice', () => execute<string>('return document.body.innerText'),
      (body) => body.includes('Local embeddings could not run'));
    console.log('Settings reports unavailable embeddings when the model cannot load.');
    await screenshot('firefox-embeddings-notice.png');
  }

  await call('/window', { handle: fixtureTab });
  await execute(`
    const frame = document.createElement('iframe');
    frame.src = '/trail/private-frame.html';
    document.body.append(frame);
  `);
  await call('/window', { handle: captureTab });
  await until('late password frame removes the Visit', visits, (rows) => !rows.some(({ url }) => url === second));
  console.log('A late password field in an iframe removes its top-level Visit.');

  // IPA symbols must render from a system font in Gecko too (ticket 27).
  await asyncScript(`
    const done = arguments[arguments.length - 1];
    const request = indexedDB.open('trailmap');
    request.onerror = () => done(false);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('expeditions', 'readwrite');
      tx.objectStore('expeditions').put({ id: 'ipa', title: 'ˤ: the pharyngealization mark in IPA', startedAt: 1_747_000_000_000,
        endedAt: 1_747_000_001_000, centroid: null, drivingQuestion: 'What are ʕ and ʔ next to ˤ?', kind: 'learning',
        threadId: null, userEdited: false, fieldNotes: null });
      tx.oncomplete = () => { db.close(); done(true); };
    };
  `);
  await openExtensionPage('journal.html');
  await until('IPA title in the Journal', () => execute<string>('return document.body.innerText'),
    (body) => body.includes('ˤ: the pharyngealization mark in IPA'));
  await screenshot('firefox-journal-ipa.png');
  console.log('The Journal shows an IPA symbol title in Gecko.');

  // A PDF in Gecko's own viewer: the text comes from the background page's re-fetch, parsed by the bundled pdf.js.
  const paper = `${fixtureOrigin}/pdf/paper.pdf`;
  await call('/window', { handle: fixtureTab });
  await goto(paper);
  await call('/window', { handle: captureTab });
  const pdfPage = await until('PDF text from the bundled pdf.js', () => read<{ canonicalUrl: string; text: string }>('pages'),
    (rows) => rows.some(({ canonicalUrl, text }) => canonicalUrl === paper && text.includes('Compaction merges sorted runs')), 30_000);
  assert(pdfPage.find(({ canonicalUrl }) => canonicalUrl === paper)?.text.includes('memtable'));
  assert((await visits()).some((row) => row.url === paper && row.pdf), 'the PDF is a PDF Visit');
  console.log('A PDF in the Gecko viewer is read with the bundled pdf.js.');
} catch (error) {
  const log = Bun.file(join(root, 'geckodriver.log'));
  if (await log.exists()) console.error((await log.text()).slice(-6000));
  throw error;
} finally {
  fixture.stop(true);
  if (session) await request(session, undefined, 'DELETE').catch(() => {});
  driver?.kill();
  await driver?.exited;
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Gecko may still be exiting; the OS temp dir is cleaned later. */ }
}
