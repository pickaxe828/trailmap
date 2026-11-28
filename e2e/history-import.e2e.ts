import { join } from 'node:path';
import { expect, test } from './fixtures';

test('restores rough trails from browser history without text or duplicates', async ({
  context, fixtureUrl, openExtensionPage, readCapture, readVisits,
}, info) => {
  const settings = await openExtensionPage('settings.html');
  await settings.getByLabel('Site to skip').fill('skip.test');
  await settings.getByRole('button', { name: 'Add site' }).click();
  await expect(settings.getByRole('button', { name: 'Remove skip.test from skip list' })).toBeVisible();

  const page = await context.newPage();
  await page.goto(fixtureUrl('skip.test', '/trail/other.html'));
  await page.goto(fixtureUrl('mail.test', '/trail/other.html'));
  const startUrl = fixtureUrl('learn.test', '/trail/start.html');
  const articleUrl = fixtureUrl('learn.test', '/trail/article.html');
  await page.goto(startUrl);
  await page.locator('#same-tab').click();
  await expect.poll(async () => (await readVisits()).map((visit) => visit.url).sort()).toEqual([startUrl, articleUrl].sort());
  await expect.poll(async () => (await readCapture('pages')).length).toBeGreaterThan(0);
  await page.close();

  // Reset Trailmap without touching Chrome's history database or closing Dexie's connections.
  await settings.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('trailmap');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const stores = Array.from(db.objectStoreNames);
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      for (const store of stores) tx.objectStore(store).clear();
    };
  }));
  expect(await readVisits()).toEqual([]);

  await settings.getByRole('tab', { name: 'History import' }).click();
  await settings.getByRole('radio', { name: '60 days' }).click();
  const importButton = settings.getByRole('button', { name: 'Import history' });
  await importButton.click();
  await expect(settings.getByRole('status').filter({ hasText: 'Imported 2 Visits' })).toBeVisible();
  const [start, article] = (await readVisits()).sort((a, b) => a.startedAt - b.startedAt);
  expect(start).toMatchObject({ url: startUrl, parentVisitId: null, imported: true });
  expect(article).toMatchObject({ url: articleUrl, transition: 'link', parentVisitId: start!.id, expeditionId: start!.expeditionId, imported: true });
  const expeditions = await readCapture('expeditions');
  expect(expeditions).toMatchObject([{ id: start!.expeditionId, imported: true, endedAt: article!.startedAt }]);
  expect(await readCapture('pages')).toEqual([]);
  await settings.getByRole('region', { name: 'History import' }).screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'history-import-complete.png') : info.outputPath('history-import-complete.png') });
  const result = await readVisits();
  await importButton.click();
  await expect(settings.getByRole('status').filter({ hasText: 'No new Visits to import' })).toBeVisible();
  expect(await readVisits()).toEqual(result);
  expect(await readCapture('expeditions')).toEqual(expeditions);

  const journal = await openExtensionPage('journal.html');
  await expect(journal.getByText('Imported from history')).toBeVisible();
  await journal.getByRole('heading', { name: 'Trail start' }).click();
  await expect(journal.getByRole('button', { name: 'Trail article' })).toBeVisible();
  await journal.getByRole('region', { name: 'Expedition trail' }).screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'history-import-trail.png') : info.outputPath('history-import-trail.png') });
});

test('onboarding shows history import progress and Settings can cancel the same run', async ({
  openExtensionPage, readVisits, serviceWorker,
}, info) => {
  const settings = await openExtensionPage('settings.html#history-import');
  const onboarding = await openExtensionPage('onboarding.html');
  await onboarding.getByRole('button', { name: 'Next: AI notes' }).click();
  await onboarding.getByRole('button', { name: 'Skip AI setup' }).click();
  const worker = await serviceWorker();
  // Hold the Chrome API response so the test can exercise Cancel before a small import finishes.
  await worker.evaluate(() => {
    const search = chrome.history.search.bind(chrome.history);
    const gate = Promise.withResolvers<void>();
    chrome.history.search = (async (query: chrome.history.HistoryQuery) => {
      await gate.promise;
      return search(query);
    }) as typeof chrome.history.search;
    Object.assign(globalThis, { releaseHistorySearch: gate.resolve });
  });

  await onboarding.getByRole('radio', { name: '90 days' }).click();
  await onboarding.getByRole('button', { name: 'Import history' }).click();
  await expect(onboarding.getByRole('progressbar', { name: 'Reading browser history…' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Import history' })).toBeDisabled();
  await onboarding.getByRole('region', { name: 'History import' }).screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'history-import-progress.png') : info.outputPath('history-import-progress.png') });
  await settings.getByRole('button', { name: 'Cancel import' }).click();
  await expect(onboarding.getByRole('progressbar', { name: 'Cancelling import…' })).toBeVisible();
  await worker.evaluate(() => (globalThis as unknown as { releaseHistorySearch(): void }).releaseHistorySearch());
  await expect(onboarding.getByRole('status').filter({ hasText: 'Import cancelled' })).toBeVisible();
  expect(await readVisits()).toEqual([]);
  await expect(settings.getByRole('button', { name: 'Import history' })).toBeEnabled();
});
