import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Expedition, Visit } from '../packages/shared/src/domain';
import { expect, seedCapture } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true });

const day = 86_400_000;
const start = Date.now() - 3 * day;
const expedition = (id: string, title: string, at: number): Expedition => ({
  id, rootVisitId: `${id}-visit`, title, startedAt: at, endedAt: at + 60_000, drivingQuestion: `What is ${title}?`, kind: 'learning',
  fieldNotes: `## What you found\n\nGenerated notes about ${title}.`, userEdited: false, threadId: null, wrappedUpAt: at + 60_000,
});
const visit = (id: string, title: string, expeditionId: string, at: number): Visit => ({
  id, title, expeditionId, startedAt: at, url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`, tabId: 1,
  parentVisitId: null, transition: 'typed', activeMs: 80_000, scrollDepth: 1, engagement: 'read',
});

/** Contrast of an element's text against the first opaque surface behind it (WCAG relative luminance). */
async function contrast(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const rgb = (value: string) => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data) as [number, number, number, number];
    };
    let surface: [number, number, number, number] | undefined;
    for (let node: Element | null = element; node && !surface; node = node.parentElement) {
      const color = rgb(getComputedStyle(node).backgroundColor);
      if (color[3] === 255) surface = color;
    }
    const text = rgb(getComputedStyle(element).color);
    const luminance = ([r, g, b]: number[]) => {
      const [lr, lg, lb] = [r, g, b].map((v) => { const c = v! / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
    };
    const [a, b] = [luminance(text), luminance(surface ?? [255, 255, 255, 255])].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  });
}

/** Skips the debounce: the real queued job becomes due and the real jobs alarm fires. */
async function makeDue(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('trailmap');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('jobs', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore('jobs');
        store.openCursor().onsuccess = ({ target }) => {
          const cursor = (target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          if (cursor.value.kind === 'notes_enrichment') cursor.update({ ...cursor.value, availableAt: 0 });
          cursor.continue();
        };
      });
    } finally { db.close(); }
    await chrome.alarms.create('trailmap.jobs', { when: Date.now() + 500 });
  });
}

test('writing My notes teaches the Atlas a solid concept and turns the Journal card to full contrast', async ({
  context, openExtensionPage, readCapture, mockOrigin,
}, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  await seedCapture(setup, {
    expeditions: [expedition('deletes', 'Replicated deletes', start), expedition('gossip', 'Gossip protocols', start + day)],
    visits: [visit('deletes-visit', 'Deleting from replicas', 'deletes', start), visit('gossip-visit', 'Gossip primer', 'gossip', start + day)],
  });

  const journal = await openExtensionPage('journal.html');
  const card = (title: string) => journal.locator('[data-my-notes]').filter({ has: journal.getByRole('heading', { name: title }) });
  await expect(card('Replicated deletes')).toHaveAttribute('data-my-notes', 'none');
  await expect(card('Replicated deletes').getByText('No notes yet')).toBeVisible();
  const proof = (name: string) => join(process.env.PROOF_DIR ?? info.outputDir, name);
  await journal.setViewportSize({ width: 1280, height: 800 });
  const fadedContrast = await contrast(journal, '[data-my-notes="none"] h3');
  expect(fadedContrast).toBeGreaterThanOrEqual(4.5); // faded is lower emphasis, still AA

  const page = await openExtensionPage('expedition.html?id=deletes');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('heading', { name: 'My notes' })).toBeVisible();
  await expect(page.getByText('Generated notes about Replicated deletes.')).toBeVisible();
  await page.getByRole('button', { name: 'Write my notes' }).click();
  await page.getByLabel('My notes Markdown').fill('A tombstone keeps a deleted item around until every replica has seen the delete.');
  await page.getByRole('button', { name: 'Save my notes' }).click();
  await expect(page.getByText('A tombstone keeps a deleted item around')).toBeVisible();
  await page.screenshot({ path: proof('expedition-my-notes.png') });
  // Saving never touches the generated notes, and the model has not been asked yet: the pass is debounced.
  expect(await readCapture('expeditions')).toContainEqual(expect.objectContaining({
    id: 'deletes', fieldNotes: expect.stringContaining('Generated notes'), myNotes: expect.stringContaining('tombstone') }));
  await expect.poll(async () => (await readCapture('jobs')).filter(({ kind }) => kind === 'notes_enrichment').length).toBe(1);
  const asked = async () => ((await (await fetch(mockOrigin + '/test/calls')).json()) as { text?: { format: { name: string } } }[])
    .filter((call) => call.text?.format.name === 'notes_enrichment');
  expect(await asked()).toHaveLength(0);

  // Skip the pause: make the real queued job due and fire the real jobs alarm.
  await makeDue(page);
  await expect.poll(async () => (await readCapture('conceptEvidence')).map(({ role, name }) => [role, name]), { timeout: 60_000 })
    .toEqual([['learned', 'Tombstone']]);
  const [sent] = await asked();
  expect(JSON.stringify(sent)).toContain('A tombstone keeps a deleted item');
  expect(JSON.stringify(sent)).not.toContain('Generated notes'); // the generated notes are not "my notes"
  expect((await readCapture('sentToModel')).filter(({ task }) => task === 'notes_enrichment')).toHaveLength(1);

  // The Atlas shows it at once, solid, though it was met on no page.
  const [concept] = await readCapture('concepts');
  const atlas = await openExtensionPage(`atlas.html?concept=${concept!.id}`);
  await atlas.setViewportSize({ width: 1280, height: 900 });
  await expect(atlas.getByText('1 of 1 concepts on the map')).toBeVisible();
  await expect(atlas.getByText('Learned: it comes from your own notes.')).toBeVisible();
  await atlas.screenshot({ path: proof('atlas-learned.png') });

  // The Journal card switches to full contrast; the one without notes stays faded.
  await journal.reload();
  await expect(card('Replicated deletes')).toHaveAttribute('data-my-notes', 'written');
  await expect(card('Gossip protocols')).toHaveAttribute('data-my-notes', 'none');
  const fullContrast = await contrast(journal, '[data-my-notes="written"] h3');
  expect(fullContrast).toBeGreaterThan(await contrast(journal, '[data-my-notes="none"] h3'));
  await journal.screenshot({ path: proof('journal-my-notes.png') });
});

test('with “Use my notes” off, My notes never leave the machine', async ({ context, openExtensionPage, readCapture, mockOrigin }) => {
  const settings = await openExtensionPage('settings.html#privacy');
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  await settings.getByRole('tab', { name: 'Privacy' }).click();
  const toggle = settings.getByRole('switch', { name: 'Use my notes to build concepts and threads' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await seedCapture(settings, { expeditions: [expedition('deletes', 'Replicated deletes', start)],
    visits: [visit('deletes-visit', 'Deleting from replicas', 'deletes', start)] });
  const page = await openExtensionPage('expedition.html?id=deletes');
  await page.getByRole('button', { name: 'Write my notes' }).click();
  await page.getByLabel('My notes Markdown').fill('A tombstone is a deletion marker.');
  await page.getByRole('button', { name: 'Save my notes' }).click();
  await expect(page.getByText('A tombstone is a deletion marker.')).toBeVisible();
  await expect.poll(async () => (await readCapture('jobs')).filter(({ kind }) => kind === 'notes_enrichment').length).toBe(1);
  await makeDue(page);
  // The job is discarded without any request, and nothing is logged as sent.
  await expect.poll(async () => (await readCapture('jobs')).filter(({ kind }) => kind === 'notes_enrichment').length, { timeout: 90_000 }).toBe(0);
  const calls = (await (await fetch(mockOrigin + '/test/calls')).json()) as { text?: { format: { name: string } } }[];
  expect(calls.filter((call) => call.text?.format.name === 'notes_enrichment')).toHaveLength(0);
  expect((await readCapture('sentToModel')).filter(({ task }) => task === 'notes_enrichment')).toHaveLength(0);
  expect(await readCapture('conceptEvidence')).toHaveLength(0);
});

test('every changed page shows the faded and solid looks, the note marker and the setting, in both themes', async ({ openExtensionPage }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  const member = (id: string, title: string, at: number, extra: Partial<Expedition> = {}): Expedition =>
    ({ ...expedition(id, title, at), threadId: 'rep', ...extra });
  const visits = [visit('a1', 'Tombstones explained', 'a', start), { ...visit('a2', 'Replica sync notes', 'a', start + 5_000), parentVisitId: 'a1' },
    visit('b1', 'Gossip protocols primer', 'b', start + day), visit('c1', 'Bloom filters', 'c', start + 2 * day), visit('d1', 'Merkle trees', 'd', start + 3 * day)];
  const evidence = (id: string, conceptId: string, name: string, visitId: string, role: 'explains' | 'learned', extra = {}) => ({
    id, conceptId, name, gloss: `About ${name}.`, kind: 'concept' as const, role, visitId, canonicalUrl: visitId === 'a' ? '' : `https://learn.test/${visitId}`,
    startedAt: start, embedding: null, ...extra });
  await seedCapture(setup, {
    expeditions: [member('a', 'Replicated deletes', start, { myNotes: 'A tombstone keeps a deleted item until every replica has seen the delete.' }),
      member('b', 'Gossip protocols', start + day), expedition('c', 'Bloom filters', start + 2 * day),
      { ...expedition('d', 'Merkle trees', start + 3 * day), myNotes: 'Hashes of hashes let two replicas find what differs.' }],
    visits,
    notes: [{ id: 'stop-note', nodeId: 'a1', text: 'Remember: the marker, not the item, travels.', at: start }],
    threads: [{ id: 'rep', title: 'Replication research', question: 'How do replicas stay consistent?', status: 'active', lastActiveAt: start + day,
      livingNote: 'Deletes travel as markers.', centroid: null, conceptIds: [] }],
    concepts: [
      { id: 'tombstone', name: 'Tombstone', aliases: [], kind: 'concept', gloss: 'About Tombstone.', embedding: null, exposure: 0, firstSeen: start },
      { id: 'gossip', name: 'Gossip protocol', aliases: [], kind: 'concept', gloss: 'About Gossip protocol.', embedding: null, exposure: 2, firstSeen: start + day },
    ],
    conceptEvidence: [evidence('learned', 'tombstone', 'Tombstone', 'a', 'learned', { expeditionId: 'a' }),
      evidence('seen-1', 'gossip', 'Gossip protocol', 'b1', 'explains'), evidence('seen-2', 'gossip', 'Gossip protocol', 'c1', 'explains')],
  });
  const surfaces = [
    ['journal', 'journal.html', 'Journal'], ['expedition', 'expedition.html?id=a&stop=a1', 'Replicated deletes'],
    ['thread', 'thread.html?id=rep', 'Replication research'], ['atlas', 'atlas.html?concept=tombstone', 'Atlas'],
    ['settings', 'settings.html#privacy', 'Settings'],
  ] as const;
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const [name, path, title] of surfaces) {
      const page = await openExtensionPage(path);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      if (name === 'journal') {
        await expect(page.locator('[data-my-notes="written"]')).toHaveCount(1);
        await expect(page.locator('[data-my-notes="none"]')).toHaveCount(1);
        expect(await contrast(page, '[data-my-notes="none"] h3')).toBeGreaterThanOrEqual(4.5);
      }
      if (name === 'expedition') {
        await expect(page.getByRole('img', { name: 'Has my note' })).toHaveCount(1); // only the stop that has one
        await expect(page.getByText('Remember: the marker, not the item, travels.')).toBeVisible();
        await expect(page.getByText('A tombstone keeps a deleted item until every replica')).toBeVisible();
      }
      if (name === 'thread') {
        await expect(page.locator('.react-flow__node')).toHaveCount(3);
        await expect(page.locator('[data-my-notes="written"]')).toHaveCount(1);
        await expect(page.locator('[data-my-notes="none"]')).toHaveCount(1);
        expect(await contrast(page, '[data-my-notes="none"] + h3 a')).toBeGreaterThanOrEqual(4.5);
      }
      if (name === 'atlas') {
        await expect(page.locator('canvas.sigma-nodes')).toBeVisible();
        await expect(page.getByText('Learned: it comes from your own notes.')).toBeVisible();
        await expect(page.getByText('2 of 2 concepts on the map')).toBeVisible();
        if (process.env.PROOF_DIR) await page.waitForTimeout(1_000); // let the layout settle for the picture
      }
      if (name === 'settings') {
        await page.getByRole('tab', { name: 'Privacy' }).click();
        await expect(page.getByRole('switch', { name: 'Use my notes to build concepts and threads' })).toBeChecked();
      }
      if (process.env.PROOF_DIR) await page.screenshot({ path: join(process.env.PROOF_DIR, `${name}-1280-${colorScheme}.png`) });
      await page.close();
    }
  }
  void info;
});
