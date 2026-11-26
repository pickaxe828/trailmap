import { join } from 'node:path';
import type { Page as BrowserPage } from '@playwright/test';
import type { Concept, Expedition, Page, Visit } from '../packages/shared/src/domain';
import type { ConceptEvidence } from '../packages/extension/src/concepts/evidence';
import { expect } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true });

test('two related sittings become one Journal thread with both trails and an incremental living note', async ({
  context, openExtensionPage, readCapture, mockOrigin,
}, info) => {
  const panel = await openExtensionPage('sidepanel.html');
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));

  const now = Date.now();
  const canonicalUrl = 'https://learn.test/replicated-lists';
  const expeditions: Expedition[] = ['CRDT replication basics', 'CRDT replication deletes'].map((title, i) => ({
    id: `session-${i}`, rootVisitId: `visit-${i}`, title, startedAt: now - (2 - i) * 86_400_000,
    endedAt: null, drivingQuestion: null, kind: 'learning', fieldNotes: null, userEdited: true, threadId: null,
  }));
  const visits: Visit[] = expeditions.map(({ id, startedAt, rootVisitId }, i) => ({
    id: rootVisitId!, startedAt, expeditionId: id, url: canonicalUrl, canonicalUrl,
    title: i ? 'Replicated lists revisited' : 'Replicated lists primer', tabId: 1, parentVisitId: null, transition: 'typed',
    engagement: 'read', activeMs: 80_000, scrollDepth: 1,
  }));
  const pages: Page[] = [{ canonicalUrl, sourceUrl: canonicalUrl, text: 'Raw article text must not be sent.', textHash: 'fixture',
    summary: 'Replicas track deletions with tombstones.', takeaways: [], embedding: null, pageKind: 'article', enrichedAt: now }];
  const concept: Concept = { id: 'tombstone', name: 'Tombstone', aliases: [], kind: 'concept', gloss: 'A deletion marker',
    embedding: null, firstSeen: expeditions[0]!.startedAt, exposure: 1 };
  const conceptEvidence: ConceptEvidence[] = visits.map(({ id, startedAt }) => ({
    id: `evidence-${id}`, conceptId: concept.id, visitId: id, canonicalUrl, startedAt, name: concept.name, kind: concept.kind,
    gloss: concept.gloss, role: 'explains', embedding: null,
  }));
  // Seed one sitting at a time: automatic closure would otherwise wrap up
  // both historical fixtures before the test can observe the first one alone.
  await seed(panel, { expeditions: [expeditions[0]!], visits: [visits[0]!], pages,
    concepts: [concept], conceptEvidence: [conceptEvidence[0]!] });

  const wrapUp = (expeditionId: string) => panel.evaluate((id) =>
    chrome.runtime.sendMessage({ type: 'trailmap.wrapUp', expeditionId: id }), expeditionId);
  await wrapUp('session-0');
  await expect.poll(async () => (await readCapture('expeditions')).find(({ id }) => id === 'session-0')?.fieldNotes).toContain('A tombstone');
  const journal = await openExtensionPage('journal.html');
  await expect(journal.getByRole('link', { name: 'CRDT replication basics' })).toBeVisible();
  await expect(journal.getByText('2 sessions')).toHaveCount(0);

  await seed(panel, { expeditions: [expeditions[1]!], visits: [visits[1]!], conceptEvidence: [conceptEvidence[1]!] });
  await wrapUp('session-1');
  await expect(journal.getByText('2 sessions')).toBeVisible({ timeout: 30_000 });
  await expect(journal.getByRole('link', { name: 'CRDT replication deletes' })).toHaveCount(0);
  const proof = (name: string) => process.env.PROOF_DIR ? join(process.env.PROOF_DIR, name) : info.outputPath(name);
  await journal.screenshot({ path: proof('journal.png') });
  await journal.getByRole('heading', { name: 'CRDT replication basics' }).click();
  await expect(journal.getByRole('link', { name: 'CRDT replication deletes' })).toBeVisible();
  await expect(journal.getByRole('link', { name: 'Replicated lists primer' })).toBeVisible();
  await expect(journal.getByRole('link', { name: 'Replicated lists revisited' })).toBeVisible();
  await expect(journal.getByText('Revisited: Replicated lists revisited')).toBeVisible();
  await expect(journal.getByText('Concepts returned: Tombstone')).toBeVisible();
  await expect(journal.getByText('Both sessions support the revised conclusion.')).toBeVisible({ timeout: 30_000 });
  await journal.screenshot({ path: proof('thread.png'), fullPage: true });

  const calls = await (await fetch(mockOrigin + '/test/calls')).json() as { text?: { format: { name: string } }; input: { content: string }[] }[];
  const notes = calls.filter((call) => call.text?.format.name === 'living_note').map((call) => JSON.parse(call.input[0]!.content));
  expect(notes).toHaveLength(2);
  expect(notes[0]).toMatchObject({ livingNote: null, fieldNotes: expect.stringContaining('A tombstone records') });
  expect(notes[1]).toMatchObject({ livingNote: 'The first session explains tombstones.', fieldNotes: expect.stringContaining('A tombstone records') });
  expect(JSON.stringify(notes)).not.toContain('Raw article text');

  await journal.getByRole('button', { name: 'Rename thread' }).click();
  await journal.getByRole('textbox', { name: 'Thread name' }).fill('Replicated list research');
  await journal.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(journal.getByRole('heading', { name: 'Replicated list research' })).toBeVisible();
  await journal.getByRole('button', { name: 'Mark done' }).click();
  await expect(journal.getByText('Done', { exact: true })).toBeVisible();
  await expect.poll(async () => (await readCapture('corrections')).sort((a, b) => a.at - b.at).map(({ kind }) => kind))
    .toEqual(['thread-rename', 'thread-done']);
});

test('a one-tap suggestion groups two sessions; detaching restores their Expedition cards', async ({ openExtensionPage, readCapture }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  const at = Date.now();
  const expeditions: Expedition[] = ['Replica clocks', 'Clock drift'].map((title, i) => ({
    id: `session-${i}`, title, startedAt: at - (2 - i) * 86_400_000, endedAt: at - (2 - i) * 86_400_000 + 1000,
    drivingQuestion: null, kind: 'learning', fieldNotes: 'Research notes', userEdited: false, threadId: null,
    threadSuggestion: i ? { kind: 'expedition', id: 'session-0' } : undefined,
  }));
  await seed(setup, { expeditions });
  const journal = await openExtensionPage('journal.html');
  const suggestion = journal.getByRole('button', { name: 'Add: Part of Replica clocks?' });
  await expect(suggestion).toBeVisible();
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'suggestion.png') : info.outputPath('suggestion.png') });
  await suggestion.click();
  await expect(journal.getByText('2 sessions')).toBeVisible();
  await journal.getByRole('heading', { name: 'Replica clocks' }).click();
  await journal.getByRole('button', { name: 'Detach session' }).last().click();
  await journal.getByRole('button', { name: 'Detach', exact: true }).click();
  await expect(journal.getByRole('link', { name: 'Clock drift' })).toBeVisible();
  await expect(journal.getByRole('link', { name: 'Replica clocks' })).toBeVisible();
  await expect(journal.getByText('2 sessions')).toHaveCount(0);
  await expect(journal.getByText('Part of Replica clocks?')).toHaveCount(0);
  await expect.poll(async () => (await readCapture('corrections')).sort((a, b) => a.at - b.at).map(({ kind }) => kind))
    .toEqual(['journal-start', 'thread-detach']);
});

test('marking an expedition as learning generates field notes; marking it not learning clears them', async ({
  context, openExtensionPage,
}, info) => {
  const panel = await openExtensionPage('sidepanel.html');
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const at = Date.now() - 86_400_000;
  const canonicalUrl = 'https://learn.test/replicated-lists';
  await seed(panel, {
    expeditions: [{ id: 'learn', rootVisitId: 'visit', title: 'Replicated lists', kind: 'unclassified',
      startedAt: at, endedAt: at + 1000, drivingQuestion: null, fieldNotes: null, userEdited: false, threadId: null }],
    visits: [{ id: 'visit', startedAt: at, expeditionId: 'learn', url: canonicalUrl, canonicalUrl, title: 'Replicated lists',
      tabId: 1, parentVisitId: null, transition: 'typed', engagement: 'read', activeMs: 80_000, scrollDepth: 1 }],
    pages: [{ canonicalUrl, sourceUrl: canonicalUrl, text: 'Article text', textHash: 'fixture',
      summary: 'Replicas track deletions with tombstones.', takeaways: [], embedding: null, pageKind: 'article', enrichedAt: at }],
  });
  const journal = await openExtensionPage('journal.html');
  await expect(journal.getByText('Mark as learning?', { exact: true })).toBeVisible();
  await journal.getByRole('button', { name: 'Select', exact: true }).click();
  await journal.getByRole('checkbox', { name: 'Select Replicated lists' }).check();
  await journal.getByRole('button', { name: 'Mark as learning', exact: true }).click();
  await expect(journal.getByText('New field notes')).toBeVisible({ timeout: 30_000 });
  await journal.getByRole('heading', { name: 'Replicated lists' }).click();
  const finding = journal.getByText(/A tombstone records/);
  await expect(finding).toBeVisible();
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'learning.png') : info.outputPath('learning.png') });
  await journal.getByRole('button', { name: 'Mark as not learning' }).click();
  await expect(finding).toHaveCount(0);
  await journal.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(finding).toBeVisible();
});

async function seed(page: BrowserPage, rows: { expeditions: Expedition[]; visits?: Visit[]; pages?: Page[];
  concepts?: Concept[]; conceptEvidence?: ConceptEvidence[] }) {
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
