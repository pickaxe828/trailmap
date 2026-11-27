import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { expect, test } from './fixtures';

const ARTICLE = '/content/article.html';
const ORIGINAL = 'Tombstones preserve the fact that an item was deleted.';
const UPDATED = `${ORIGINAL}\n\n- Check how replicas agree on when to remove them.`;

async function proof(panel: Page, name: string) {
  const dir = process.env.NOTES_PROOF_DIR;
  if (!dir) return;
  for (const colorScheme of ['light', 'dark'] as const) {
    await panel.emulateMedia({ colorScheme });
    await panel.screenshot({ path: join(dir, `${name}-${colorScheme}.png`), animations: 'disabled' });
  }
}

test.use({ companionInstalled: true });

test('page notes follow the active Visit, share one undo per edit, and can be forgotten', async ({
  context, fixtureUrl, openExtensionPage, readCapture,
}) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 820 });
  const thisPage = panel.getByRole('region', { name: 'This page' });
  const note = thisPage.getByRole('textbox', { name: 'Page note' });
  const saved = thisPage.getByRole('status').filter({ hasText: /^Saved$/ });
  const article = await context.newPage();
  await article.goto(fixtureUrl('learn.test', ARTICLE));
  await expect(thisPage.getByRole('heading', { name: 'Deleting items in a replicated list' })).toBeVisible();
  await expect(thisPage.getByRole('link', { name: 'Deleting items in a replicated list' })).toHaveAttribute('href', /expedition\.html\?id=/);

  await note.fill(ORIGINAL);
  await note.blur();
  await expect(saved).toBeVisible();
  await proof(panel, 'article-note-saved');
  await note.fill('Rewriting the same note');
  await expect(saved).toBeVisible(); // First debounce fires while the field stays focused.
  await note.fill(UPDATED);
  const other = await context.newPage();
  await other.goto(fixtureUrl('other.test', '/trail/other.html'));
  await expect(thisPage.getByText('other.test', { exact: true })).toBeVisible();
  await expect(note).toHaveValue('');
  await article.bringToFront();
  await expect(note).toHaveValue(UPDATED);
  await expect.poll(async () => (await readCapture('corrections')).filter(({ kind }) => kind === 'note')).toHaveLength(2);

  const myNotesToggle = thisPage.getByRole('button', { name: 'My notes for this expedition' });
  await expect(myNotesToggle).toHaveAttribute('aria-expanded', 'false');
  await myNotesToggle.evaluate((button: HTMLButtonElement) => button.click());
  const myNotes = thisPage.getByRole('textbox', { name: 'My notes Markdown' });
  await myNotes.fill('Compare deletion strategies across replicated lists.');
  await myNotes.blur();
  await expect.poll(async () => (await readCapture('expeditions')).map(({ myNotes }) => myNotes)).toContain('Compare deletion strategies across replicated lists.');
  await myNotesToggle.evaluate((button: HTMLButtonElement) => button.click());

  const journal = await openExtensionPage('journal.html');
  await journal.getByRole('button', { name: 'Recent changes (2)' }).click();
  const undo = journal.getByRole('button', { name: 'Undo: Edited page note' });
  await expect(undo).toHaveCount(2);
  await undo.first().click();
  await expect(undo).toHaveCount(1);
  await article.bringToFront();
  await expect(note).toHaveValue(ORIGINAL);

  const visit = (await readCapture('visits')).find(({ url }) => url === article.url());
  expect(visit).toBeDefined();
  const forget = await panel.evaluate(async (canonicalUrl) => chrome.runtime.sendMessage({
    type: 'trailmap.correction', action: 'forget-page', canonicalUrl,
  }), visit!.canonicalUrl);
  expect(forget).toBe(true);
  await expect(thisPage.getByText('This page isn’t recorded.')).toBeVisible();
  await expect(note).toHaveCount(0);
  expect(await readCapture('notes')).toEqual([]);
  await expect(undo).toHaveCount(0);
  await proof(panel, 'not-recorded');

  // Default-denied and password-protected navigations cannot expose either editor.
  for (const [host, path] of [['mail.test', ARTICLE], ['learn.test', `${ARTICLE}?private`]] as const) {
    await article.goto(fixtureUrl(host, path));
    await expect(panel.getByRole('switch', { name: `Record ${host}` })).not.toBeChecked();
    await expect(note).toHaveCount(0);
    await expect(myNotesToggle).toHaveCount(0);
  }
});
