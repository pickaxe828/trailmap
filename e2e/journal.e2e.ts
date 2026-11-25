import { join } from 'node:path';
import type { Page as BrowserPage } from '@playwright/test';
import type { Expedition, Page, Query, Visit } from '../packages/shared/src/domain';
import { expect, test } from './fixtures';

const start = Date.UTC(2025, 4, 12, 12);
const expedition = (id: string, title: string, startedAt: number, extra: Partial<Expedition> = {}): Expedition => ({
  id, title, startedAt, endedAt: startedAt + 1000, centroid: null,
  drivingQuestion: null, kind: 'learning', threadId: null, userEdited: false, fieldNotes: null, ...extra,
});

test('the Journal opens from the side panel and shows the newest Expeditions first, with errands collapsed', async ({ context, openExtensionPage }, info) => {
  const panel = await openExtensionPage('sidepanel.html');
  await seed(panel, { expeditions: [
    expedition('errand', 'Buy a desk lamp', start + 3_600_000, { kind: 'errand' }),
    expedition('older', 'Vector clocks', start),
    expedition('newer', 'Tombstones in CRDTs', start + 1_800_000, { unseenNotes: 1 }),
  ] });
  const [journal] = await Promise.all([context.waitForEvent('page'), panel.getByRole('link', { name: 'Open Journal' }).click({ timeout: 5000 })]);
  await expect(journal.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
  await expect(journal.getByRole('heading', { level: 3 })).toHaveText(['Tombstones in CRDTs', 'Vector clocks']);
  const errands = journal.getByRole('button', { name: /Errands/ });
  await expect(errands).toHaveAttribute('aria-expanded', 'false');
  await expect(journal.getByRole('link', { name: 'Buy a desk lamp' })).toBeHidden();
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'journal.png') : info.outputPath('journal.png') });
  await errands.click();
  await expect(journal.getByRole('link', { name: 'Buy a desk lamp' })).toBeVisible();
});

test('opening field notes marks them seen and a Markdown edit survives reload', async ({ openExtensionPage, readCapture }) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seed(setup, { expeditions: [expedition('research:crdt', 'Tombstones in CRDTs', start, {
    drivingQuestion: 'How do replicated deletes work?', fieldNotes: '## Found\n\nDeletes use tombstones.', unseenNotes: 1,
  })] });
  const journal = await openExtensionPage('journal.html');
  await journal.getByRole('heading', { name: 'Tombstones in CRDTs' }).click({ timeout: 5000 });
  await expect(journal.getByRole('heading', { name: 'Field notes' })).toBeVisible();
  await expect(journal.getByText('Deletes use tombstones.')).toBeVisible();
  await expect.poll(async () => (await readCapture('expeditions'))[0]?.unseenNotes).toBeUndefined();
  await journal.getByRole('button', { name: 'Edit field notes' }).click();
  await journal.getByLabel('Field notes Markdown').fill('## My findings\n\nKeep the tombstone until every replica has seen it.');
  await journal.getByRole('button', { name: 'Save field notes' }).click();
  await expect(journal.getByRole('heading', { name: 'My findings' })).toBeVisible();
  await journal.reload();
  await expect(journal.getByText('Keep the tombstone until every replica has seen it.')).toBeVisible();
  expect((await readCapture('expeditions'))[0]?.userEdited).toBe(true);
  expect((await readCapture('corrections')).map(({ kind, targetIds }) => [kind, targetIds]))
    .toEqual([['field-notes', ['research:crdt']]]);
});

test('an Expedition shows questions, skipped branches, and Page details with a reopen link', async ({ context, fixtureUrl, openExtensionPage }, info) => {
  const url = fixtureUrl('learn.test', '/article.html');
  const page = await openReview(openExtensionPage, url);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.reload();
  const search = page.getByRole('button', { name: 'How do CRDTs delete?' });
  const article = page.getByRole('button', { name: 'CRDT reference' });
  const skipped = page.getByRole('button', { name: '+2 skipped' });
  await expect(search).toBeVisible();
  await expect(article.getByText('Replicas use tombstones.')).toBeVisible();
  await expect(skipped).toBeVisible();
  expect((await article.boundingBox())!.x).toBeGreaterThan((await search.boundingBox())!.x);
  const edges = page.locator('.react-flow__edge-path');
  await expect(edges).toHaveCount(2);
  await expect.poll(() => edges.evaluateAll((paths) => paths.map((path) => getComputedStyle(path).strokeDasharray)))
    .toEqual(['none', '6px, 4px']);
  await skipped.click();
  await expect(page.getByRole('button', { name: 'Unread blog' })).toBeVisible();
  await article.click();
  await expect(page.getByText('Keep markers until all replicas sync.')).toBeVisible();
  expect(requests.filter((url) => !url.startsWith('chrome-extension://'))).toEqual([]);
  await page.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'expedition.png') : info.outputPath('expedition.png') });
  const [reopened] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Reopen page' }).click()]);
  await expect(reopened).toHaveURL(url);
});

test('rename, drag to move, and merge on the Expedition page use the correction log', async ({ fixtureUrl, openExtensionPage, readCapture }, info) => {
  const page = await openReview(openExtensionPage, fixtureUrl('learn.test', '/article.html'));
  await page.getByRole('button', { name: 'Rename expedition' }).click({ timeout: 5000 });
  await page.getByLabel('Expedition name').fill('Replicated deletes');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Replicated deletes' })).toBeVisible();

  const article = page.getByRole('button', { name: 'CRDT reference' });
  await article.dragTo(page.getByText('Drop a trail card here to move it.'), { timeout: 5000 });
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('CRDT reference')).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Destination expedition' }).click();
  await page.getByRole('option', { name: 'Vector clocks' }).click();
  await page.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'move-page.png') : info.outputPath('move-page.png') });
  await dialog.getByRole('button', { name: 'Move page' }).click();
  await expect(article).toHaveCount(0);

  await page.getByRole('button', { name: 'Merge expeditions' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Expedition to merge' }).click();
  await page.getByRole('option', { name: 'Replication basics' }).click();
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replication primer' })).toBeVisible();
  expect((await readCapture('visits')).find(({ id }) => id === 'article')?.expeditionId).toBe('older');
  expect((await readCapture('expeditions')).map(({ id }) => id)).toEqual(['crdt', 'older']);
  expect((await readCapture('corrections')).map(({ kind }) => kind).sort()).toEqual(['merge', 'move', 'rename']);
});

async function openReview(openExtensionPage: (path: string) => Promise<BrowserPage>, url: string) {
  const setup = await openExtensionPage('sidepanel.html');
  const search = 'https://www.google.com/search?q=CRDTs';
  const visit: Visit = {
    id: 'search', url: search, canonicalUrl: search, title: 'Search', tabId: 1, parentVisitId: null, transition: 'search',
    startedAt: start, activeMs: 0, scrollDepth: 0, engagement: 'bounced', expeditionId: 'crdt',
  };
  await seed(setup, {
    expeditions: [
      expedition('crdt', 'Tombstones in CRDTs', start, { rootVisitId: visit.id,
        fieldNotes: `## Found\n\nDeletes use [markers](${url}).\n\n![Remote image](https://images.test/remote.png)` }),
      expedition('older', 'Vector clocks', start - 1000, { rootVisitId: 'clock' }),
      expedition('merge', 'Replication basics', start - 2000, { rootVisitId: 'basics' }),
    ],
    visits: [visit, { ...visit, id: 'article', url, canonicalUrl: url, title: 'CRDT reference', parentVisitId: 'search',
      startedAt: start + 1, activeMs: 65_000, engagement: 'read', transition: 'link' },
    { ...visit, id: 'blog', title: 'Unread blog', parentVisitId: 'search', startedAt: start + 2, transition: 'new-tab' },
    { ...visit, id: 'other', title: 'Unread reference', parentVisitId: 'blog', startedAt: start + 3, transition: 'link' },
    { ...visit, id: 'clock', title: 'Clock reference', expeditionId: 'older', engagement: 'skimmed', transition: 'link' },
    { ...visit, id: 'basics', title: 'Replication primer', expeditionId: 'merge', engagement: 'skimmed', transition: 'link' }],
    queries: [{ id: 'query', visitId: 'search', engine: 'google', q: 'How do CRDTs delete?', at: start, expeditionId: 'crdt' }],
    pages: [{ canonicalUrl: url, text: '', textHash: 'hash', summary: 'Replicas use tombstones.',
      takeaways: ['Keep markers until all replicas sync.'], embedding: null, pageKind: 'article', enrichedAt: start }],
  });
  return openExtensionPage('expedition.html?id=crdt');
}

async function seed(page: BrowserPage, rows: {
  expeditions: Expedition[]; visits?: Visit[]; pages?: Page[]; queries?: Query[];
}) {
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
        for (const [table, records] of Object.entries(rows)) {
          for (const row of records) tx.objectStore(table).put(row);
        }
      });
    } finally { db.close(); }
  }, rows);
}
