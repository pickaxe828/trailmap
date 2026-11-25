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
import { chromium, test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPANION_BIN, EXTENSION_DIR, FIXTURE_PORT } from './constants';

type Fixtures = {
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
};

type Options = {
  /** `test.use({ companionInstalled: true })` installs the real companion into the profile before the browser starts. */
  companionInstalled: boolean;
};

export const test = base.extend<Fixtures & Options>({
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
    await use({ TRAILMAP_COMPANION_DATA_DIR: companionDataDir, TRAILMAP_SECRET_STORE: 'file' });
  },

  installCompanion: async ({ userDataDir }, use) => {
    await use(() => {
      execFileSync(COMPANION_BIN, ['install', '--user-data-dir', userDataDir], { stdio: 'pipe' });
    });
  },

  context: async ({ userDataDir, companionEnv, companionInstalled, installCompanion }, use) => {
    if (companionInstalled) installCompanion();
    const context = await chromium.launchPersistentContext(userDataDir, {
      env: { ...process.env, ...companionEnv } as Record<string, string>,
      channel: 'chromium', // full Chromium in new headless mode; the old headless shell can't load extensions
      headless: true,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        '--host-resolver-rules=MAP *.test 127.0.0.1',
      ],
    });
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

  fixtureUrl: async ({}, use) => {
    await use((host, path = '/') => `http://${host}:${FIXTURE_PORT}${path}`);
  },
});

export { expect };
