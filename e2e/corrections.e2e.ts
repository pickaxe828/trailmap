import { join } from 'node:path';
import { expect, test } from './fixtures';

/** Set PROOF_DIR to keep screenshots outside Playwright's cleaned-up output folder. */
const shotPath = (name: string, fallback: string) => process.env.PROOF_DIR ? join(process.env.PROOF_DIR, name) : fallback;

const searchUrl = (query: string) => 'https://www.google.com/search?q=' + encodeURIComponent(query);

test('the live trail marks the current page, and split, rename, star and forget work through the side panel', async ({
  context, fixtureUrl, openExtensionPage, readCapture,
}, testInfo) => {
  const articleUrl = fixtureUrl('learn.test', '/trail/article.html');
  await context.route('https://www.google.com/search?*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Search results</title><a href="${articleUrl}">Read about replication</a>`,
  }));
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 420, height: 720 });

  const research = await context.newPage();
  await research.goto(searchUrl('crdt replication'));
  await research.getByRole('link', { name: 'Read about replication' }).click();
  await expect(research).toHaveURL(articleUrl);
  await research.bringToFront();

  const crdt = panel.getByRole('tree', { name: 'crdt replication' });
  const articleRow = crdt.locator('.astryx-tree-list-item', { hasText: 'Trail article' });
  await expect(articleRow).toBeVisible();
  await expect(articleRow.getByText('You are here')).toBeVisible();
  await expect(crdt.locator('.astryx-tree-list-item', { hasText: 'crdt replication' }).getByText('You are here')).toHaveCount(0);
  await panel.screenshot({ path: shotPath('live-trail.png', testInfo.outputPath('live-trail.png')) });

  // Star it: persisted on the Visit and shown on the row.
  await articleRow.getByRole('button', { name: 'Star page' }).click();
  await expect(articleRow.getByText('Key page')).toBeVisible();
  await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === articleUrl)?.starred).toBe(true);

  // Add a note.
  await articleRow.getByRole('button', { name: /Actions for/ }).click();
  await panel.getByRole('menuitem', { name: 'Add note' }).click();
  await panel.getByRole('dialog').getByRole('textbox', { name: 'Note', exact: true }).fill('check the delete semantics');
  await panel.getByRole('button', { name: 'Save note' }).click();
  await expect(articleRow.getByText('Note: check the delete semantics')).toBeVisible();

  // Split the expedition at the article.
  await articleRow.getByRole('button', { name: /Actions for/ }).click();
  await panel.getByRole('menuitem', { name: 'Split expedition here' }).click();
  await expect(panel.getByRole('tree')).toHaveCount(2);
  await expect(crdt.getByText('Trail article')).toHaveCount(0);
  await expect.poll(async () => {
    const [queries, expeditions] = [await readCapture('queries'), await readCapture('expeditions')];
    return { expeditions: expeditions.length, queryStays: queries[0]?.expeditionId === expeditions.find((e) => e.title === 'crdt replication')?.id };
  }).toEqual({ expeditions: 2, queryStays: true });

  // Rename the new expedition.
  await panel.getByRole('button', { name: 'Actions for expedition Trail article' }).click();
  await panel.getByRole('menuitem', { name: 'Rename' }).click();
  await panel.getByRole('textbox', { name: 'Expedition name' }).fill('Replication reading');
  await panel.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Replication reading' })).toBeVisible();
  await expect.poll(async () => (await readCapture('expeditions')).find((e) => e.title === 'Replication reading')?.userEdited).toBe(true);
  await panel.screenshot({ path: shotPath('after-split-and-rename.png', testInfo.outputPath('after-split-and-rename.png')) });
  const log = await readCapture('corrections');
  expect([...log].sort((a, b) => a.at - b.at).map(({ kind }) => kind)).toEqual(['star', 'note', 'split', 'rename']);

  // Forget the page: gone from the tree and from IndexedDB, including notes and the log entries about it.
  const renamed = panel.getByRole('tree', { name: 'Replication reading' });
  await renamed.getByRole('button', { name: /Actions for/ }).first().click();
  await panel.getByRole('menuitem', { name: 'Forget page' }).click();
  await panel.getByRole('alertdialog').getByRole('button', { name: 'Forget page' }).click();
  await expect(panel.getByText('Trail article')).toHaveCount(0);
  await expect.poll(async () => (await readCapture('visits')).some(({ url }) => url === articleUrl)).toBe(false);
  expect(await readCapture('notes')).toEqual([]);
  expect(JSON.stringify(await readCapture('corrections'))).not.toContain('check the delete semantics');
  expect((await readCapture('pages')).some(({ canonicalUrl }) => canonicalUrl === articleUrl)).toBe(false);
});

test.describe('while a Visit waits for its title', () => {
  test.use({ controlledCaptureClock: true });

  test('a Visit’s Actions menu survives assignment to an open Expedition', async ({
    context, fixtureUrl, openExtensionPage,
  }) => {
    const url = fixtureUrl('learn.test', '/trail/start.html');
    // Keep the Visit unassigned until we give it a title; the capture clock holds the title deadline.
    await context.route(url, (route) => route.fulfill({ contentType: 'text/html', body: '<p>Trail start</p>' }));
    const panel = await openExtensionPage('sidepanel.html');
    const research = await context.newPage();
    await research.goto(url);
    await research.bringToFront();
    const today = panel.getByRole('tree', { name: 'Today' });
    await expect(today.getByText('You are here')).toBeVisible();
    await today.getByRole('button', { name: 'Actions for learn.test' }).click();
    const ignore = panel.getByRole('menuitem', { name: 'Ignore learn.test' });
    await expect(ignore).toBeVisible();

    await research.evaluate(() => { document.title = 'Trail start'; });
    await expect(panel.getByRole('heading', { name: 'Trail start', exact: true })).toBeVisible();
    await expect(ignore).toBeVisible();
    await panel.keyboard.press('Escape');
    await expect(panel.getByRole('tree', { name: 'Trail start' })
      .getByRole('button', { name: 'Actions for Trail start' })).toBeVisible();
    await expect(today).toHaveCount(0);
  });
});

test('ignoring a site uses the recording skip list, purges history and stops new capture', async ({
  context, fixtureUrl, openExtensionPage, readCapture,
}) => {
  const first = fixtureUrl('learn.test', '/trail/start.html');
  const panel = await openExtensionPage('sidepanel.html');
  const page = await context.newPage();
  await page.goto(first);
  await page.bringToFront();
  const expedition = panel.getByRole('tree', { name: 'Trail start' });
  const row = expedition.locator('.astryx-tree-list-item', { hasText: 'Trail start' });
  await expect(row.getByText('You are here')).toBeVisible();

  await row.getByRole('button', { name: /Actions for/ }).click();
  await panel.getByRole('menuitem', { name: 'Ignore learn.test' }).click();
  await expect.poll(() => panel.evaluate(async () => {
    const key = 'trailmap.recordingSettings';
    const settings = (await chrome.storage.local.get(key))[key] as { skippedHosts: string[] } | undefined;
    return settings?.skippedHosts;
  }), { timeout: 0 }).toEqual(['learn.test']);
  await expect(row).not.toBeVisible();

  await page.goto(fixtureUrl('learn.test', '/trail/article.html'));
  await page.goto(fixtureUrl('learn.test', '/trail/other.html'));
  expect(await readCapture('visits')).toEqual([]);
  expect(JSON.stringify(await readCapture('corrections'))).not.toContain('learn.test');
});
