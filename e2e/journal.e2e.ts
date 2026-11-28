import { join } from 'node:path';
import type { Page as BrowserPage } from '@playwright/test';
import type { Expedition, Page, Query, Visit } from '../packages/shared/src/domain';
import { expect, seedCapture, test } from './fixtures';

const start = Date.UTC(2025, 4, 12, 12);
const expedition = (id: string, title: string, startedAt: number, extra: Partial<Expedition> = {}): Expedition => ({
  id, title, startedAt, endedAt: startedAt + 1000, centroid: null,
  drivingQuestion: null, kind: 'learning', threadId: null, userEdited: false, fieldNotes: null, ...extra,
});

test('the Journal opens from the side panel and shows the newest Expeditions first, with Other browsing collapsed', async ({ context, openExtensionPage }, info) => {
  const panel = await openExtensionPage('sidepanel.html');
  await seed(panel, { expeditions: [
    expedition('errand', 'Buy a desk lamp', start + 3_600_000, { kind: 'errand' }),
    expedition('older', 'Vector clocks', start),
    expedition('newer', 'Tombstones in CRDTs', start + 1_800_000, { unseenNotes: 1 }),
  ] });
  const [journal] = await Promise.all([context.waitForEvent('page'), panel.getByRole('link', { name: 'Open Journal' }).click({ timeout: 5000 })]);
  await expect(journal.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
  await expect(journal.getByRole('heading', { level: 3 })).toHaveText(['Tombstones in CRDTs', 'Vector clocks']);
  const other = journal.getByRole('button', { name: /Other browsing/ });
  await expect(other).toHaveAttribute('aria-expanded', 'false');
  await expect(journal.getByRole('link', { name: 'Buy a desk lamp' })).toBeHidden();
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'journal.png') : info.outputPath('journal.png') });
  await other.click();
  await expect(journal.getByRole('link', { name: 'Buy a desk lamp' })).toBeVisible();
});

test('dismissing an inline merge suggestion removes it from both cards across reload', async ({ openExtensionPage }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seed(setup, { expeditions: [
    expedition('source', 'Replicated lists', start, { mergeSuggestions: [
      { expeditionId: 'target', reason: 'Both sessions cover replicated deletes.' },
      { expeditionId: 'gone', reason: 'Stale suggestion' },
    ] }),
    expedition('target', 'Delete markers', start + 1000),
  ] });
  const journal = await openExtensionPage('journal.html');
  await expect(journal.getByText('Same topic as Replicated lists?')).toBeVisible();
  await expect(journal.getByText('Same topic as Delete markers?')).toBeVisible();
  await expect(journal.getByRole('heading', { name: 'Merge suggestions' })).toHaveCount(0);
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'journal-merges.png') : info.outputPath('journal-merges.png') });
  await journal.getByRole('button', { name: 'Dismiss: Same topic as Replicated lists?' }).click();
  await expect(journal.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await journal.reload();
  await expect(journal.getByRole('link', { name: 'Replicated lists' })).toBeVisible();
  await expect(journal.getByText(/Same topic as/)).toHaveCount(0);
});

for (const width of [1280, 360]) {
  test(`Journal cards share one bottom edge and suggestion rows stay readable at ${width}px`, async ({ openExtensionPage }, info) => {
    const long = 'Epaxial musculature of the lumbar spine and how it stabilises the human back';
    const setup = await openExtensionPage('sidepanel.html');
    await seed(setup, { expeditions: [
      expedition('a', 'What is a recurrent neural network', start + 3000, { mergeSuggestions: [{ expeditionId: 'b', reason: 'Same topic' }] }),
      expedition('b', long, start + 2000, { drivingQuestion: 'Which muscles keep the spine upright while we walk?' }),
      expedition('c', 'Two line card title about replicated deletes and tombstones in CRDTs', start + 1000,
        { drivingQuestion: 'How do replicated deletes avoid resurrecting removed items?' }),
    ] });
    const journal = await openExtensionPage('journal.html');
    await journal.setViewportSize({ width, height: 900 });
    const cards = journal.locator('article');
    await expect(cards).toHaveCount(3);
    await expect(journal.getByText(`Same topic as ${long}?`).first()).toBeVisible();
    const surfaces = journal.locator('article > *');
    const bottoms = await surfaces.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().bottom)));
    const tops = await surfaces.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    if (width > 1000) expect(new Set(bottoms).size).toBe(1);
    else for (let i = 1; i < 3; i += 1) expect(tops[i]! - bottoms[i - 1]!).toBe(tops[1]! - bottoms[0]!);
    const row = journal.getByRole('group', { name: `Same topic as ${long}?` });
    const text = await row.getByText(`Same topic as ${long}?`).first().boundingBox();
    const merge = await row.getByRole('button', { name: `Merge: Same topic as ${long}?` }).boundingBox();
    const dismiss = await row.getByRole('button', { name: `Dismiss: Same topic as ${long}?` }).boundingBox();
    const box = await row.boundingBox();
    for (const target of [merge, dismiss]) {
      expect(target).not.toBeNull();
      expect(target!.x + target!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
      const apart = target!.y >= text!.y + text!.height - 1 || target!.x >= text!.x + text!.width - 1;
      expect(apart).toBe(true);
    }
    expect(await row.getByText(`Same topic as ${long}?`).first().evaluate((node) => node.scrollHeight <= node.clientHeight * 2.2)).toBe(true);
    for (const colorScheme of ['light', 'dark'] as const) {
      await journal.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, `suggestion-rows-${width}-${colorScheme}.png`) : info.outputPath(`rows-${width}-${colorScheme}.png`) });
    }
  });
}

test('Journal hover and keyboard focus highlight one surface per card', async ({ openExtensionPage }) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seedCapture(setup, {
    expeditions: [
      expedition('solar', 'How solar panels work', start + 3000, { myNotes: 'Photovoltaics convert sunlight into electricity.' }),
      expedition('cells', 'Photovoltaic cells', start + 2000, { kind: 'unclassified' }),
      expedition('first', 'Vector clocks', start, { threadId: 'clocks' }),
      expedition('second', 'Clock drift', start + 500, { threadId: 'clocks' }),
      expedition('markers', 'Delete markers', start - 500, { mergeSuggestions: [{ expeditionId: 'replicas', reason: 'Same topic' }] }),
      expedition('replicas', 'Replicated deletes', start - 1000),
    ],
    threads: [{ id: 'clocks', title: 'Distributed clocks', question: null, lastActiveAt: start + 1500,
      status: 'active', livingNote: null, centroid: null, conceptIds: [] }],
  });
  const journal = await openExtensionPage('journal.html');
  await journal.setViewportSize({ width: 1280, height: 900 });
  const cards = journal.getByRole('article');
  await expect(cards).toHaveCount(5);
  const journalHeading = journal.getByRole('heading', { name: 'Journal', exact: true });
  const unclassified = journal.getByRole('link', { name: 'Photovoltaic cells', exact: true });
  const link = journal.getByRole('link', { name: 'How solar panels work', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await journal.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const screenshot = async (state: string) => {
      if (process.env.PROOF_DIR) await journal.screenshot({ path: join(process.env.PROOF_DIR, `journal-cards-${colorScheme}-${state}.png`) });
    };
    await journalHeading.click(); // Keep hover and keyboard focus off the cards at rest.
    await screenshot('rest');
    for (const [title, state] of [
      ['How solar panels work', 'plain-hover'], ['Photovoltaic cells', 'unclassified-hover'],
      ['Distributed clocks', 'thread-hover'], ['Delete markers', 'merge-hover'],
    ] as const) {
      const card = cards.filter({ has: journal.getByRole('heading', { name: title, exact: true }) });
      const surface = card.locator('.astryx-card, .astryx-clickable-card');
      await journalHeading.hover();
      await expect(surface).toHaveCount(1);
      // Astryx paints the hover tint with an overlay, not by recolouring the base card.
      const paint = () => surface.evaluate((node) => [null, '::before', '::after'].map((pseudo) => {
        const { backgroundColor, opacity } = getComputedStyle(node, pseudo);
        return { backgroundColor, opacity };
      }));
      const restingPaint = await paint();
      await card.getByRole('heading', { level: 3 }).hover();
      await expect.poll(paint).not.toEqual(restingPaint);
      expect(await surface.boundingBox()).toEqual(await card.boundingBox());
      await screenshot(state);
    }
    await journalHeading.hover();
    await journal.getByRole('button', { name: 'Select', exact: true }).focus();
    await journal.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await journal.keyboard.press('Tab');
    await expect(unclassified).toBeFocused();
    await screenshot('focus');
  }
  await journal.keyboard.press('Shift+Tab');
  await expect(link).toBeFocused();
  await journal.keyboard.press('Enter');
  await expect(journal).toHaveURL(/expedition\.html\?id=solar$/);
});

test('an unclassified Journal card has one Mark as learning action and activating it does not open the Expedition', async ({ openExtensionPage }) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seedCapture(setup, { expeditions: [expedition('cells', 'Photovoltaic cells', start, { kind: 'unclassified' })] });
  const journal = await openExtensionPage('journal.html');
  const card = journal.getByRole('article').filter({ has: journal.getByRole('heading', { name: 'Photovoltaic cells' }) });
  const mark = card.getByRole('button', { name: 'Mark as learning', exact: true });
  await expect(card.getByText(/Mark as learning/)).toHaveCount(1);
  await mark.press('Enter');
  await expect(card.getByText('Learning', { exact: true })).toBeVisible();
  await expect(journal).toHaveURL(/journal\.html$/);
  await journal.getByRole('button', { name: 'Undo', exact: true }).click();
  await mark.click();
  await expect(card.getByText('Learning', { exact: true })).toBeVisible();
  await expect(journal).toHaveURL(/journal\.html$/);
});

test('select two cards to start a thread, then drop another expedition on it', async ({ openExtensionPage }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seed(setup, { expeditions: [expedition('a', 'Distributed clocks', start), expedition('b', 'Clock drift', start + 500),
    expedition('c', 'Timestamps', start + 1000)] });
  const journal = await openExtensionPage('journal.html');
  await expect(journal.getByText('Attach to thread')).toHaveCount(0);
  const select = journal.getByRole('button', { name: 'Select', exact: true });
  await select.click();
  for (const title of ['Distributed clocks', 'Clock drift']) {
    const checkbox = journal.getByRole('checkbox', { name: `Select ${title}` });
    await checkbox.focus();
    await checkbox.press('Space');
    await expect(checkbox).toBeChecked();
  }
  const bar = journal.getByRole('region', { name: 'Expedition selection' });
  await expect(bar.getByText('2 selected')).toBeVisible();
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'selection.png') : info.outputPath('selection.png') });
  await bar.getByRole('button', { name: 'Start thread', exact: true }).click();
  await expect(journal.getByText('2 sessions')).toBeVisible();
  await journal.getByRole('heading', { name: 'Timestamps' }).dragTo(journal.getByRole('heading', { name: 'Distributed clocks' }), { timeout: 5000 });
  const drop = journal.getByRole('dialog', { name: 'Organise dropped card' });
  await expect(drop.getByRole('button', { name: 'Merge into one expedition' })).toBeVisible();
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'drop-menu.png') : info.outputPath('drop-menu.png') });
  await drop.getByRole('button', { name: 'Add to thread', exact: true }).click();
  await expect(journal.getByText('3 sessions')).toBeVisible();
  await journal.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(journal.getByText('2 sessions')).toBeVisible();
  await expect(journal.getByRole('link', { name: 'Timestamps' })).toBeVisible();
  await journal.getByRole('heading', { name: 'Timestamps' }).click({ modifiers: ['Shift'] });
  await expect(journal.getByRole('checkbox', { name: 'Select Timestamps' })).toBeChecked();
  await journal.keyboard.press('Escape');
  await expect(select).toBeFocused();
  await journal.getByRole('heading', { name: 'Timestamps' }).click({ modifiers: ['Meta'] });
  await bar.getByRole('button', { name: 'Add to thread…' }).click();
  await journal.getByRole('menuitem', { name: 'Distributed clocks' }).click();
  await expect(journal.getByText('3 sessions')).toBeVisible();
  await journal.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(journal.getByText('2 sessions')).toBeVisible();
  // The toast only undoes the latest change; the earlier one is still in Recent changes.
  await journal.getByRole('button', { name: /^Recent changes/ }).click();
  await journal.getByRole('button', { name: /^Undo: Started a thread/ }).click();
  await expect(journal.getByText('2 sessions')).toHaveCount(0);
  await expect(journal.getByRole('link', { name: 'Clock drift' })).toBeVisible();
});

test('a merge chip moves visits to the earliest expedition and Undo restores both cards', async ({ openExtensionPage, readCapture }) => {
  const setup = await openExtensionPage('sidepanel.html');
  const expeditions = [expedition('late', 'Replica deletion', start + 500, { rootVisitId: 'late-visit',
    mergeSuggestions: [{ expeditionId: 'early', reason: 'Same topic' }] }),
  expedition('early', 'Replicated lists', start, { rootVisitId: 'early-visit' })];
  await seed(setup, { expeditions, visits: expeditions.map(({ id, title, rootVisitId, startedAt }) => ({
    id: rootVisitId!, title, startedAt, url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`,
    expeditionId: id, tabId: 1, parentVisitId: null, transition: 'typed', activeMs: 0, scrollDepth: 0, engagement: 'bounced',
  })) });
  const journal = await openExtensionPage('journal.html');
  await journal.getByRole('button', { name: 'Merge: Same topic as Replicated lists?' }).click({ timeout: 5000 });
  await expect(journal.getByRole('link', { name: 'Replica deletion' })).toHaveCount(0);
  expect((await readCapture('visits')).map(({ expeditionId }) => expeditionId)).toEqual(['early', 'early']);
  await journal.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(journal.getByRole('link', { name: 'Replica deletion' })).toBeVisible();
  expect((await readCapture('visits')).map(({ expeditionId }) => expeditionId)).toEqual(['early', 'late']);
});

test('a merge can be undone from Recent changes after a reload, and a conflicting undo is refused', async ({ openExtensionPage, readCapture }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  const expeditions = [expedition('late', 'Replica deletion', start + 500, { rootVisitId: 'late-visit',
    mergeSuggestions: [{ expeditionId: 'early', reason: 'Same topic' }] }),
  expedition('early', 'Replicated lists', start, { rootVisitId: 'early-visit' }),
  expedition('lone', 'Gossip protocols', start + 9000)];
  await seed(setup, { expeditions, visits: expeditions.slice(0, 2).map(({ id, title, rootVisitId, startedAt }) => ({
    id: rootVisitId!, title, startedAt, url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`,
    expeditionId: id, tabId: 1, parentVisitId: null, transition: 'typed', activeMs: 0, scrollDepth: 0, engagement: 'bounced',
  })) });
  const journal = await openExtensionPage('journal.html');
  await journal.getByRole('button', { name: 'Merge: Same topic as Replicated lists?' }).click({ timeout: 5000 });
  await expect(journal.getByRole('link', { name: 'Replica deletion' })).toHaveCount(0);
  await journal.reload();
  const recent = journal.getByRole('button', { name: /^Recent changes \(1\)/ });
  await recent.click();
  await expect(journal.getByText(/^Merged/)).toBeVisible();
  await journal.setViewportSize({ width: 1280, height: 800 });
  const shot = async (name: string) => {
    for (const scheme of ['light', 'dark'] as const) {
      await journal.emulateMedia({ colorScheme: scheme });
      await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, `${scheme}-${name}`) : info.outputPath(`${scheme}-${name}`) });
    }
  };
  await shot('recent-changes.png');
  await journal.getByRole('button', { name: /^Undo: Merged/ }).click();
  await expect(journal.getByRole('link', { name: 'Replica deletion' })).toBeVisible();
  expect((await readCapture('visits')).map(({ expeditionId }) => expeditionId)).toEqual(['early', 'late']);
  await expect(journal.getByRole('button', { name: /^Recent changes/ })).toHaveCount(0);

  // A later change to the same expedition makes the earlier undo unsafe.
  for (const label of ['Mark as not learning', 'Mark as learning']) {
    if (label === 'Mark as learning') await journal.getByRole('button', { name: /Other browsing/ }).click();
    await journal.getByRole('button', { name: 'Select', exact: true }).click();
    await journal.getByRole('checkbox', { name: 'Select Gossip protocols' }).check();
    await journal.getByRole('button', { name: label, exact: true }).click();
    await expect(journal.getByRole('button', { name: 'Select', exact: true })).toBeEnabled();
  }
  await journal.reload();
  await journal.getByRole('button', { name: /^Recent changes/ }).click();
  await journal.getByRole('button', { name: /^Undo: Marked “Gossip protocols” as not learning/ }).click();
  await expect(journal.getByRole('alert')).toContainText('a later change touched the same data');
  await shot('undo-refused.png');
});

test('opening field notes marks them seen and My notes survive reload beside them', async ({ openExtensionPage, readCapture }) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seed(setup, { expeditions: [expedition('research:crdt', 'Tombstones in CRDTs', start, {
    drivingQuestion: 'How do replicated deletes work?', fieldNotes: '## Found\n\nDeletes use tombstones.', unseenNotes: 1,
  })] });
  const journal = await openExtensionPage('journal.html');
  await journal.getByRole('heading', { name: 'Tombstones in CRDTs' }).click({ timeout: 5000 });
  await expect(journal.getByRole('heading', { name: 'Field notes' })).toBeVisible();
  await expect(journal.getByText('Deletes use tombstones.')).toBeVisible();
  await expect.poll(async () => (await readCapture('expeditions'))[0]?.unseenNotes).toBeUndefined();
  await journal.getByRole('button', { name: 'Write my notes' }).click();
  await journal.getByLabel('My notes Markdown').fill('## My findings\n\nKeep the tombstone until every replica has seen it.');
  await journal.getByRole('button', { name: 'Save my notes' }).click();
  await expect(journal.getByRole('heading', { name: 'My findings' })).toBeVisible();
  await journal.reload();
  await expect(journal.getByText('Keep the tombstone until every replica has seen it.')).toBeVisible();
  await expect(journal.getByText('Deletes use tombstones.')).toBeVisible(); // the generated notes are still there
  const [stored] = await readCapture('expeditions');
  expect(stored).toMatchObject({ myNotes: '## My findings\n\nKeep the tombstone until every replica has seen it.', fieldNotes: '## Found\n\nDeletes use tombstones.', userEdited: false });
  expect((await readCapture('corrections')).map(({ kind, targetIds }) => [kind, targetIds]))
    .toEqual([['my-notes', ['research:crdt']]]);
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
