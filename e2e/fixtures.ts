/**
 * E2E harness. Import `test` and `expect` from here, not from @playwright/test.
 *
 * What the `context` fixture does (see notes-01.md for the why):
 *  - launches Playwright's own Chromium in a persistent context, HEADLESS, with
 *    the built extension loaded (`bun run build` first);
 *  - maps every *.test hostname to 127.0.0.1 via --host-resolver-rules, so
 *    fixture pages live on fake hostnames like http://learn.test:4173/ and are
 *    not caught by the (future) localhost/intranet privacy deny-list;
 *  - waits for the extension's service worker, from which `extensionId` is read.
 */
import { chromium, test as base, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ConceptEvidence } from '../packages/extension/src/concepts/evidence';
import type { SentToModel } from '../packages/extension/src/db/db';
import type { Job, ModelHealth } from '../packages/extension/src/jobs/types';
import type { Concept, Edge, Expedition, Highlight, Note, Page as CapturedPage, Query, Thread, Visit } from '../packages/shared/src/domain';
import { COMPANION_BIN, EXTENSION_DIR, FIXTURE_PORT } from './constants';

type CaptureTables = {
  visits: Visit; pages: CapturedPage; queries: Query; highlights: Highlight; expeditions: Expedition; notes: Note;
  concepts: Concept; edges: Edge; threads: Thread; conceptEvidence: ConceptEvidence; sentToModel: SentToModel; jobs: Job;
  modelHealth: ModelHealth;
  corrections: { id: string; at: number; kind: string; targetIds: string[]; before: unknown; after: unknown };
};

/** Seed before opening the view under test; raw IndexedDB writes don't notify Dexie live queries. */
export async function seedCapture(page: Page, rows: { [K in keyof CaptureTables]?: CaptureTables[K][] }) {
  // Opening a database that doesn't exist yet would create it empty, with no stores to write to.
  // Readiness signal: the extension has created every store we are about to write.
  await expect.poll(() => page.evaluate(async (tables) => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'trailmap')) return false;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('trailmap');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try { return tables.every((table) => db.objectStoreNames.contains(table)); } finally { db.close(); }
  }, Object.keys(rows)), { timeout: 0 }).toBe(true);
  await page.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('trailmap');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(Object.keys(rows), 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        for (const [table, records] of Object.entries(rows)) for (const row of records ?? []) tx.objectStore(table).put(row);
      });
    } finally { db.close(); }
  }, rows as Record<string, unknown[] | undefined>);
}

/**
 * Waits until the recorder has screened a Google AI Mode document, so a typed question will be captured instead of
 * silently dropped. It reads through the install tab like `readCapture`: opening another tab would steal focus from the
 * page under test, and `pressSequentially` then hangs on a background tab.
 */
async function waitForAiModeScreened(context: BrowserContext, extensionId: string) {
  const readerUrl = `chrome-extension://${extensionId}/onboarding.html`;
  await expect.poll(async () => {
    const reader = context.pages().find((p) => p.url() === readerUrl);
    return !!reader && await reader.evaluate(async () => {
      const key = 'trailmap.recorderState';
      const state = (await chrome.storage.session.get(key))[key] as { aiEntries?: Record<string, { screened?: boolean }> } | undefined;
      return Object.values(state?.aiEntries ?? {}).some((entry) => entry.screened === true);
    });
  }, { timeout: 0 }).toBe(true);
}

type Fixtures = {
  readCapture: <T extends keyof CaptureTables>(table: T) => Promise<CaptureTables[T][]>;
  /**
   * The browser profile folder (`--user-data-dir`). Chromium looks for Native Messaging host manifests in
   * `<userDataDir>/NativeMessagingHosts/`, which is why the real companion can be installed per test.
   */
  userDataDir: string;
  /** Where the companion keeps its secrets file and `companion.log` in this test. */
  companionDataDir: string;
  /**
   * Environment variables for the companion process. Chromium passes its own environment to Native Messaging hosts,
   * so this is how a test points the companion at mock servers: override this fixture in a spec file
   * (`test.extend({ companionEnv: async ({ mockOpenAi }, use) => use({ TRAILMAP_OPENAI_BASE_URL: mockOpenAi.url }) })`).
   * Always includes `TRAILMAP_COMPANION_DATA_DIR` and `TRAILMAP_SECRET_STORE=file` (the real Keychain is never touched).
   */
  companionEnv: Record<string, string>;
  /** Runs the real `trailmap-companion install --browser chromium --user-data-dir <userDataDir>`. Call it any time, even while the browser runs. */
  installCompanion: () => void;
  context: BrowserContext;
  extensionId: string;
  /** Opens chrome-extension://<id>/<path> in a new tab, e.g. openExtensionPage('sidepanel.html'). */
  openExtensionPage: (path: string) => Promise<Page>;
  /** Builds a fixture-site URL on a fake hostname, e.g. fixtureUrl('learn.test', '/article.html'). */
  fixtureUrl: (host: string, path?: string) => string;
  /** The extension's current service worker (waits for one to start if it was stopped). */
  serviceWorker: () => Promise<Worker>;
  /** Waits until a Google AI Mode document has been screened, so the next typed question is captured (notes-35.md). */
  aiModeScreened: () => Promise<void>;
  /** Every recorded Visit, oldest first, read straight from the extension's IndexedDB. */
  readVisits: () => Promise<Visit[]>;
};

type Options = {
  realEmbedder: boolean;
  controlledCaptureClock: boolean;
  /** `test.use({ companionInstalled: true })` installs the real companion into the profile before the browser starts. */
  companionInstalled: boolean;
};

type WorkerFixtures = { fakeEmbeddingExtension: string };

export const test = base.extend<Fixtures & Options, WorkerFixtures>({
  realEmbedder: [false, { option: true }],
  controlledCaptureClock: [false, { option: true }],

  // Swap only the Embedder behind the production offscreen message handler.
  // The normal bundle has no test configuration and retains its manifest key.
  fakeEmbeddingExtension: [async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'trailmap-e2e-extension-'));
    try {
      cpSync(EXTENSION_DIR, dir, { recursive: true });
      const worker = readdirSync(join(dir, 'assets')).find((name) => /^pdf\.worker\.min-.+\.mjs$/.test(name));
      execFileSync('bun', ['build', fileURLToPath(new URL('./fake-embedder.ts', import.meta.url)),
        '--outfile', join(dir, 'fake-embedder.js'), '--define', `PDF_WORKER_URL=${JSON.stringify(`/assets/${worker}`)}`, '--define', 'import.meta.env.FIREFOX=false'], { stdio: 'pipe' });
      writeFileSync(join(dir, 'offscreen.html'), '<script type="module" src="./fake-embedder.js"></script>');
      await use(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],

  companionInstalled: [false, { option: true }],

  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'trailmap-e2e-profile-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },

  // eslint-disable-next-line no-empty-pattern
  companionDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'trailmap-e2e-companion-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },

  companionEnv: async ({ companionDataDir }, use) => {
    // Even default fixtures cannot call a real model API. Suites that drive a
    // provider override these loopback endpoints with its mock API.
    const origin = `http://127.0.0.1:${FIXTURE_PORT}`;
    await use({ TRAILMAP_COMPANION_DATA_DIR: companionDataDir, TRAILMAP_SECRET_STORE: 'file',
      TRAILMAP_OPENAI_AUTH_BASE_URL: origin, TRAILMAP_OPENAI_BASE_URL: `${origin}/v1`,
      TRAILMAP_ANTHROPIC_BASE_URL: `${origin}/v1`, TRAILMAP_OLLAMA_BASE_URL: origin });
  },

  installCompanion: async ({ userDataDir }, use) => {
    await use(() => {
      execFileSync(COMPANION_BIN, ['install', '--browser', 'chromium', '--user-data-dir', userDataDir], { stdio: 'pipe' });
    });
  },

  context: async ({ userDataDir, companionEnv, companionInstalled, installCompanion, fakeEmbeddingExtension, realEmbedder, controlledCaptureClock }, use) => {
    let extensionDir = realEmbedder ? EXTENSION_DIR : fakeEmbeddingExtension;
    if (controlledCaptureClock) {
      const copy = join(userDataDir, 'clock-extension');
      cpSync(extensionDir, copy, { recursive: true });
      extensionDir = copy;
      const worker = join(copy, 'background.js');
      // Keep real Chrome navigation, active-tab and content-script events; pin
      // the desktop focus/idle inputs that headless Chrome cannot drive portably.
      const shim = `
        globalThis.captureTestTime = Date.now();
        Date.now = () => globalThis.captureTestTime;
        const getLastFocusedWindow = chrome.windows.getLastFocused.bind(chrome.windows);
        chrome.windows.getLastFocused = async () => ({ ...await getLastFocusedWindow(), focused: true });
        chrome.windows.onFocusChanged.addListener = () => {};
        chrome.idle.queryState = async () => 'active';
        chrome.idle.onStateChanged.addListener = () => {};
      `;
      writeFileSync(worker, shim + readFileSync(worker, 'utf8'));
    }
    if (companionInstalled) installCompanion();
    const context = await chromium.launchPersistentContext(userDataDir, {
      env: { ...process.env, ...companionEnv } as Record<string, string>,
      channel: 'chromium', // full Chromium in new headless mode; the old headless shell can't load extensions
      headless: true,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--host-resolver-rules=MAP *.test 127.0.0.1',
      ],
    });
    // The background opens the onboarding tab from its `onInstalled` handler, which only runs after
    // the service worker's top level has registered every listener. Tests that navigate straight
    // away would otherwise race the registration and miss their first events.
    // No private time limit: how long a cold Chromium takes under load is not ours to guess, so the
    // test's own timeout is the only bound and a hang names this wait.
    await expect
      .poll(() => context.pages().some((p) => p.url().endsWith('/onboarding.html')), { timeout: 0 })
      .toBe(true);
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },

  openExtensionPage: async ({ context, extensionId }, use) => {
    await use(async (path) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path.replace(/^\//, '')}`);
      return page;
    });
  },

  serviceWorker: async ({ context }, use) => {
    await use(async () => context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')));
  },

  // Reads through the onboarding tab the extension opens on install (it is an extension page, so it
  // shares the extension's IndexedDB). That keeps the tab under test the active one. (Reading from the
  // service worker was flaky: `indexedDB.databases()` is empty there.)
  readCapture: async ({ context, extensionId }, use) => {
    const readerUrl = `chrome-extension://${extensionId}/onboarding.html`;
    await use(async <T extends keyof CaptureTables>(table: T) => {
      let reader = context.pages().find((p) => p.url() === readerUrl);
      if (!reader) {
        await expect.poll(() => context.pages().some((p) => p.url() === readerUrl), { timeout: 0 }).toBe(true);
        reader = context.pages().find((p) => p.url() === readerUrl)!;
      }
      return reader.evaluate(async (table) => {
        // Opening a database that doesn't exist yet would create it empty and confuse Dexie.
        if (!(await indexedDB.databases()).some((d) => d.name === 'trailmap')) return [];
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('trailmap');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(table).objectStore(table).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return rows;
      }, table) as Promise<CaptureTables[T][]>;
    });
  },

  readVisits: async ({ readCapture }, use) => use(() => readCapture('visits')),

  aiModeScreened: async ({ context, extensionId }, use) => use(() => waitForAiModeScreened(context, extensionId)),

  fixtureUrl: async ({}, use) => {
    await use((host, path = '/') => `http://${host}:${FIXTURE_PORT}${path}`);
  },
});

export { expect };
