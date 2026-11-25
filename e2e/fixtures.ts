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
import { EXTENSION_DIR, FIXTURE_PORT } from './constants';

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  /** Opens chrome-extension://<id>/<path> in a new tab, e.g. openExtensionPage('sidepanel.html'). */
  openExtensionPage: (path: string) => Promise<Page>;
  /** Builds a fixture-site URL on a fake hostname, e.g. fixtureUrl('learn.test', '/article.html'). */
  fixtureUrl: (host: string, path?: string) => string;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
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
