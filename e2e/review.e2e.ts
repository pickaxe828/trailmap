import { join } from 'node:path';
import type { ConceptEvidence } from '../packages/extension/src/concepts/evidence';
import type { Concept, Expedition } from '../packages/shared/src/domain';
import { expect, seedCapture, test } from './fixtures';

const at = Date.UTC(2026, 0, 5, 12);
const concept = (id: string, name: string, gloss: string, firstSeen: number): Concept =>
  ({ id, name, gloss, firstSeen, aliases: [], kind: 'concept', embedding: null, exposure: 0 });
const learned = (id: string, conceptId: string, name: string): ConceptEvidence => ({ id, conceptId, name, visitId: 'deletes', expeditionId: 'deletes',
  canonicalUrl: '', gloss: '', kind: 'concept', role: 'learned', salience: 'central', startedAt: at, embedding: null });
const expedition: Expedition = { id: 'deletes', title: 'Replicated deletes', kind: 'learning', startedAt: at, endedAt: at + 1000, centroid: null,
  drivingQuestion: null, threadId: null, userEdited: false, fieldNotes: null,
  myNotes: 'A CRDT lets replicas merge without a coordinator. A Tombstone marks a deleted item so the delete is not undone.' };

test('review is off until turned on, then schedules learned concepts and keeps its state on this computer', async ({ context, openExtensionPage, readCapture }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seedCapture(setup, {
    expeditions: [expedition],
    concepts: [concept('crdt', 'CRDT', 'A data type whose copies merge without conflicts.', at), concept('tombstone', 'Tombstone', 'A marker that keeps a replicated delete from being undone.', at + 1),
      concept('glimpsed', 'Glimpsed', 'Only seen.', at + 2)],
    conceptEvidence: [learned('1', 'crdt', 'CRDT'), learned('2', 'tombstone', 'Tombstone')],
  });
  const proof = (name: string) => join(process.env.PROOF_DIR ?? info.outputPath('.'), name);

  // Off by default: no entry point, no cards, no scheduling.
  const journal = await openExtensionPage('journal.html');
  await expect(journal.getByRole('link', { name: 'Atlas' })).toBeVisible();
  await expect(journal.getByRole('link', { name: 'Review' })).toHaveCount(0);
  const page = await openExtensionPage('review.html');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('heading', { name: 'Review is off' })).toBeVisible();
  expect(await readCapture('reviewCards')).toEqual([]);

  // Turn it on in Settings.
  const settings = await openExtensionPage('settings.html#review');
  const toggle = settings.getByRole('switch', { name: 'Review concepts I have learned' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(settings.getByRole('switch', { name: 'Write question cards with a model' })).not.toBeChecked();

  await expect(journal.getByRole('link', { name: 'Review' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('0 due · 2 new')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CRDT' })).toBeVisible();
  await expect(page.getByText('A data type whose copies merge')).toHaveCount(0);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: proof(`review-card-${scheme}.png`) });
  }

  // Space reveals; 3 is Good.
  await page.keyboard.press('Space');
  await expect(page.getByText('A data type whose copies merge without conflicts.')).toBeVisible();
  await expect(page.getByText('A CRDT lets replicas merge without a coordinator.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'How well did you remember it?' })).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: proof(`review-answer-${scheme}.png`) });
  }
  await page.keyboard.press('3');
  await expect(page.getByRole('heading', { name: 'Tombstone' })).toBeVisible();
  await expect.poll(async () => (await readCapture('reviewLogs')).map(({ conceptId, rating }) => [conceptId, rating])).toEqual([['crdt', 'good']]);
  const [card] = await readCapture('reviewCards');
  expect(card).toMatchObject({ conceptId: 'crdt', state: 'review', reps: 1 });
  expect(card!.due - card!.lastReview!).toBe(2 * 86_400_000);

  // A click works too; then nothing is due.
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Easy' }).click();
  await expect(page.getByRole('heading', { name: 'All done for now' })).toBeVisible();
  await expect(page.getByText(/Your next review is/).first()).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: proof(`review-empty-${scheme}.png`) });
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nothing is due' })).toBeVisible();
  expect((await readCapture('reviewLogs')).map(({ rating }) => rating).sort()).toEqual(['easy', 'good']);
  void context;
});
