import { join } from 'node:path';
import { expect, seedCapture, test } from './fixtures';

test('Journal search finds a word from a captured Page and groups it with Concepts and notes', async ({
  context, openExtensionPage, fixtureUrl, readCapture,
}, info) => {
  const url = fixtureUrl('learn.test', '/article.html');
  const article = await context.newPage();
  await article.goto(url);
  await expect.poll(async () => (await readCapture('pages')).find(({ canonicalUrl }) => canonicalUrl === url)?.text)
    .toContain('Tombstones mark deleted items.');
  const visit = (await readCapture('visits')).find(({ canonicalUrl }) => canonicalUrl === url)!;
  const setup = await openExtensionPage('sidepanel.html');
  const concept = { id: 'deletion marker', name: 'Deletion marker', aliases: ['Deleted item marker'], kind: 'concept' as const,
    gloss: 'A marker for a replicated delete.', embedding: null, exposure: 1, firstSeen: visit.startedAt };
  const session = { id: 'notes', title: 'Testing deletion', kind: 'learning' as const, startedAt: 1, endedAt: 2,
    drivingQuestion: null, threadId: 'replication', userEdited: false, fieldNotes: 'Keep markers for deleted items until all replicas sync.' };
  await seedCapture(setup, {
    visits: [{ ...visit, engagement: 'read', expeditionId: session.id }],
    concepts: [concept],
    conceptEvidence: [{ id: 'evidence', conceptId: concept.id, visitId: visit.id, canonicalUrl: url,
      startedAt: visit.startedAt, role: 'explains', name: concept.name, kind: concept.kind, gloss: concept.gloss, embedding: null }],
    expeditions: [session, { ...session, id: 'previous', title: 'First session', fieldNotes: null }],
    threads: [{ id: 'replication', title: 'Replication research', question: null, livingNote: 'Markers for deleted items preserve causality.',
      status: 'active', lastActiveAt: 2, centroid: null, conceptIds: [concept.id] }],
  });
  const journal = await openExtensionPage('journal.html');
  const search = journal.getByRole('searchbox', { name: 'Search Journal' });
  await search.fill('deleted');
  const pageResult = journal.getByRole('link', { name: /Fixture article/ });
  await expect(pageResult).toHaveAttribute('href', url);
  await expect(journal.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible();
  await expect(journal.getByRole('heading', { name: 'Concepts', exact: true })).toBeVisible();
  await expect(journal.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();
  await expect(journal.getByRole('link', { name: /Testing deletion/ })).toHaveAttribute('href', /expedition.html\?id=notes$/);
  await expect(journal.getByRole('link', { name: /Replication research/ })).toHaveAttribute('href', /thread.html\?id=replication$/);
  await expect(journal.getByRole('searchbox')).not.toHaveAttribute('aria-busy', 'true');
  await journal.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'journal-search.png') : info.outputPath('journal-search.png') });

  const [opened] = await Promise.all([context.waitForEvent('page'), journal.getByText('Fixture article', { exact: true }).click()]);
  await expect(opened).toHaveURL(url);
  await journal.getByText('Deletion marker', { exact: true }).click();
  await expect(journal.getByRole('complementary', { name: 'Concept details' }).getByRole('heading', { name: 'Deletion marker' })).toBeVisible();
  expect(await journal.evaluate(() => chrome.runtime.getManifest().omnibox?.keyword)).toBe('tm');
});
