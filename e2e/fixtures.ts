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
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Concept, Edge, Expedition, Highlight, Note, Page as CapturedPage, Query, Visit } from '../packages/shared/src/domain';
import { COMPANION_BIN, EXTENSION_DIR, FIXTURE_PORT } from './constants';

type CaptureTables = {
  visits: Visit; pages: CapturedPage; queries: Query; highlights: Highlight; expeditions: Expedition; notes: Note;
  concepts: Concept; edges: Edge;
  corrections: { id: string; at: number; kind: string; targetIds: string[]; before: unknown; after: unknown };
};

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
  /** Runs the real `trailmap-companion install --user-data-dir <userDataDir>`. Call it any time, even while the browser runs. */
  installCompanion: () => void;
  context: BrowserContext;
  extensionId: string;
  /** Opens chrome-extension://<id>/<path> in a new tab, e.g. openExtensionPage('sidepanel.html'). */
  openExtensionPage: (path: string) => Promise<Page>;
  /** Builds a fixture-site URL on a fake hostname, e.g. fixtureUrl('learn.test', '/article.html'). */
  fixtureUrl: (host: string, path?: string) => string;
  /** The extension's current service worker (waits for one to start if it was stopped). */
  serviceWorker: () => Promise<Worker>;
  /** Every recorded Visit, oldest first, read straight from the extension's IndexedDB. */
  readVisits: () => Promise<Visit[]>;
};

type Options = {
  realEmbedder: boolean;
  /** `test.use({ companionInstalled: true })` installs the real companion into the profile before the browser starts. */
  companionInstalled: boolean;
};

type WorkerFixtures = { fakeEmbeddingExtension: string };

export const test = base.extend<Fixtures & Options, WorkerFixtures>({
  realEmbedder: [false, { option: true }],

  // Swap only the Embedder behind the production offscreen message handler.
  // The normal bundle has no test configuration and retains its manifest key.
  fakeEmbeddingExtension: [async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'trailmap-e2e-extension-'));
    try {
      cpSync(EXTENSION_DIR, dir, { recursive: true });
      execFileSync('bun', ['build', fileURLToPath(new URL('./fake-embedder.ts', import.meta.url)),
        '--outfile', join(dir, 'fake-embedder.js')], { stdio: 'pipe' });
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
    // Provider discovery must never probe an actual local Ollama instance in tests.
    await use({ TRAILMAP_COMPANION_DATA_DIR: companionDataDir, TRAILMAP_SECRET_STORE: 'file',
      TRAILMAP_OLLAMA_BASE_URL: `http://127.0.0.1:${FIXTURE_PORT}` });
  },

  installCompanion: async ({ userDataDir }, use) => {
    await use(() => {
      execFileSync(COMPANION_BIN, ['install', '--user-data-dir', userDataDir], { stdio: 'pipe' });
    });
  },

  context: async ({ userDataDir, companionEnv, companionInstalled, installCompanion, fakeEmbeddingExtension, realEmbedder }, use) => {
    const extensionDir = realEmbedder ? EXTENSION_DIR : fakeEmbeddingExtension;
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
    await expect
      .poll(() => context.pages().some((p) => p.url().endsWith('/onboarding.html')), { timeout: 15_000 })
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
        await expect.poll(() => context.pages().some((p) => p.url() === readerUrl), { timeout: 10_000 }).toBe(true);
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

  fixtureUrl: async ({}, use) => {
    await use((host, path = '/') => `http://${host}:${FIXTURE_PORT}${path}`);
  },
});

export { expect };
