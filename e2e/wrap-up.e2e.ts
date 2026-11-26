import { expect } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true });

test('Wrap up titles the Expedition, writes field notes with citations and loose ends, and counts them on the badge', async ({
  context, extensionId, openExtensionPage, fixtureUrl, readCapture, serviceWorker, mockOrigin,
}, testInfo) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 820 });
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));

  const article = await context.newPage();
  await article.goto(fixtureUrl('learn.test', '/content/article.html'));
  await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.length > 0)).toBe(true);
  await article.locator('#highlight').selectText();
  await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === article.url())?.engagement).toBe('read');
  // A tab that was opened and closed without reading it.
  const opened = context.waitForEvent('page');
  await article.evaluate((url) => { window.open(url); }, fixtureUrl('unread.test', '/trail/other.html'));
  const unread = await opened;
  await expect.poll(async () => (await readCapture('visits')).some(({ url }) => url.includes('unread.test'))).toBe(true);
  await unread.close();
  await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url.includes('unread.test'))?.expeditionId).toBeTruthy();
  expect(await readCapture('expeditions')).toHaveLength(1);

  await panel.getByRole('button', { name: /^Wrap up expedition/ }).first().click();
  await expect(panel.getByRole('heading', { name: 'Field notes' })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await readCapture('expeditions'))[0]?.fieldNotes, { timeout: 60_000 }).not.toBeNull();

  const [expedition] = await readCapture('expeditions');
  expect(expedition).toMatchObject({
    title: 'How replicated lists delete items', drivingQuestion: 'How do replicated lists represent deletes?',
    kind: 'learning', unseenNotes: 1, userEdited: false,
  });
  expect(expedition!.fieldNotes).toContain('## Key ideas');
  expect(expedition!.fieldNotes).toContain('A tombstone records that an item was deleted. ([Deleting items in a replicated list](');
  expect(expedition!.fieldNotes).toContain('Opened but never read: [');

  const badge = async () => (await serviceWorker()).evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.action.getBadgeText({ tabId: tab!.id });
  });
  await article.bringToFront();
  await expect.poll(badge).toBe('1');

  const calls = await (await fetch(mockOrigin + '/test/calls')).json() as { text?: { format: { name: string } }; input: { content: string }[] }[];
  const wrapUpCall = calls.find((call) => call.text?.format.name === 'expedition_wrap_up')!;
  expect(wrapUpCall.input[0]!.content).not.toContain('unread.test');
  // Page notes and the user's highlight go out; the captured Page text does not.
  expect(wrapUpCall.input[0]!.content).toContain('Tombstones retain deletion history across replicas.');
  expect(wrapUpCall.input[0]!.content).not.toContain('This paragraph appears');
  expect(JSON.parse(wrapUpCall.input[0]!.content).trail[0]).not.toHaveProperty('text');

  await panel.getByText('How replicated lists delete items (new)').click();
  await expect(panel.getByRole('heading', { name: 'What you found' })).toBeVisible();
  await expect(panel.getByText('How are tombstones garbage collected?')).toBeVisible();
  await expect.poll(async () => (await readCapture('expeditions'))[0]?.unseenNotes).toBeUndefined();
  await expect.poll(badge).not.toBe('1');
  await panel.screenshot({ path: testInfo.outputPath('wrap-up.png') });
});
