import { join } from 'node:path';
import { expect, seedCapture } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true });

test('Ask answers from a captured Page with a citation, logs one model call, and says so when nothing matches', async ({
  context, openExtensionPage, fixtureUrl, readCapture,
}, info) => {
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const url = fixtureUrl('learn.test', '/article.html');
  const article = await context.newPage();
  await article.goto(url);
  await expect.poll(async () => (await readCapture('pages')).find(({ canonicalUrl }) => canonicalUrl === url)?.text)
    .toContain('Tombstones mark deleted items.');
  const visit = (await readCapture('visits')).find(({ canonicalUrl }) => canonicalUrl === url)!;
  await seedCapture(await openExtensionPage('sidepanel.html'), { visits: [{ ...visit, engagement: 'read' }] });
  const asks = async () => (await readCapture('sentToModel')).filter(({ task }) => task === 'ask');
  const proof = (name: string) => join(process.env.PROOF_DIR ?? info.outputPath('.'), name);

  const journal = await openExtensionPage('journal.html');
  await journal.setViewportSize({ width: 1280, height: 800 });
  await journal.getByRole('textbox', { name: 'Ask your trails' }).fill('How do tombstones mark deleted items?');
  await journal.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(journal.getByText('Tombstones mark deleted items so every replica can see the deletion.')).toBeVisible();
  const source = journal.getByRole('link', { name: 'Fixture article Page' });
  await expect(source).toHaveAttribute('href', url);
  await expect.poll(async () => (await asks()).filter(({ outcome }) => outcome === 'succeeded').length).toBe(1);
  const [sent] = await asks();
  expect(JSON.parse(sent!.input[0]!.content)).toMatchObject({ question: 'How do tombstones mark deleted items?', passages: [{ ref: 'p1' }] });
  expect(sent!.canonicalUrls).toContain(url);
  for (const scheme of ['light', 'dark'] as const) {
    await journal.emulateMedia({ colorScheme: scheme });
    await journal.screenshot({ path: proof(`ask-answered-${scheme}.png`) });
  }

  // The unrelated question never reaches the model: there is nothing to send, so nothing is logged.
  await journal.getByRole('textbox', { name: 'Ask your trails' }).fill('What is the capital of France?');
  await journal.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(journal.getByText('Nothing in your trails answers this.')).toBeVisible();
  expect(await asks()).toHaveLength(1);
  for (const scheme of ['light', 'dark'] as const) {
    await journal.emulateMedia({ colorScheme: scheme });
    await journal.screenshot({ path: proof(`ask-nothing-${scheme}.png`) });
  }

  // `tm ?question` lands here with the question typed and runs it.
  const fromOmnibox = await openExtensionPage('journal.html?ask=How+do+tombstones+work%3F');
  await expect(fromOmnibox.getByText('Tombstones mark deleted items so every replica can see the deletion.')).toBeVisible();
  await expect.poll(async () => (await asks()).length).toBe(2);
});
