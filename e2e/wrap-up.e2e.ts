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
  expect(expedition!.unreadStops?.length).toBeGreaterThan(0);
  expect(expedition!.fieldNotes).not.toContain('Opened but never read:');

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

test.describe('automatic wrap-up', () => {
  test.use({ controlledCaptureClock: true });

  test('Expedition inactivity writes field notes while the computer stays active', async ({
    context, openExtensionPage, fixtureUrl, readCapture, serviceWorker,
  }, testInfo) => {
    const settings = await openExtensionPage('settings.html');
    await signInToMockChatGpt(context, settings);
    const research = await context.newPage();
    await research.goto(fixtureUrl('learn.test', '/content/article.html'));
    await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.length > 0)).toBe(true);
    await research.locator('#highlight').selectText();
    await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === research.url())?.engagement).toBe('read');
    await expect.poll(async () => (await readCapture('expeditions')).length).toBe(1);
    const [first] = await readCapture('expeditions');
    const worker = await serviceWorker();
    const advance = (ms: number) => worker.evaluate((ms) => {
      return (globalThis as typeof globalThis & { captureTestTime: number }).captureTestTime += ms;
    }, ms);
    const closeAlarm = 'trailmap.expedition-close';
    const deadline = () => worker.evaluate(async (name) => (await chrome.alarms.get(name))?.scheduledTime, closeAlarm);
    const fireAlarm = () => worker.evaluate(async (name) => {
      await chrome.alarms.create(name, { when: new Date().getTime() + 100 });
    }, closeAlarm);

    await expect.poll(deadline).toBe(first!.startedAt + 20 * 60_000);
    // The same page is still being read, so the original deadline must not close it.
    const readingAt = await advance(20 * 60_000);
    await fireAlarm();
    await expect.poll(deadline).toBe(readingAt + 20 * 60_000);
    expect((await readCapture('expeditions')).find(({ id }) => id === first!.id)?.endedAt).toBeNull();

    const unrelated = await context.newPage();
    await unrelated.goto(fixtureUrl('unrelated.test', '/trail/other.html'));
    await expect.poll(async () => (await readCapture('expeditions')).length).toBe(2);

    await settings.bringToFront();
    const inactivity = settings.getByLabel('Expedition inactivity');
    await expect(inactivity).toHaveValue('20');
    const topicSwitch = settings.getByLabel('Topic switch');
    await expect(topicSwitch).toHaveValue('10');
    await topicSwitch.fill('9');
    await topicSwitch.press('Tab');
    await inactivity.fill('2');
    await inactivity.press('Tab');
    await expect.poll(deadline).toBe(readingAt + 2 * 60_000);
    await settings.reload();
    await expect(inactivity).toHaveValue('2');
    await expect(topicSwitch).toHaveValue('9');
    await settings.locator('#privacy').screenshot({ path: testInfo.outputPath('expedition-recording-settings.png') });

    await unrelated.bringToFront();
    const unrelatedTabId = (await readCapture('visits')).find(({ url }) => url === unrelated.url())?.tabId;
    expect(unrelatedTabId).toBeDefined();
    await expect.poll(() => worker.evaluate(async () => {
      const { 'trailmap.recorderState': state } = await chrome.storage.session.get('trailmap.recorderState') as {
        'trailmap.recorderState'?: { focusedWindowId: number; activeTabByWindow: Record<number, number> };
      };
      return state?.activeTabByWindow[state.focusedWindowId];
    })).toBe(unrelatedTabId);
    await advance(2 * 60_000);
    await fireAlarm();
    await expect.poll(async () => (await readCapture('expeditions')).find(({ id }) => id === first!.id), { timeout: 60_000 })
      .toMatchObject({ endedAt: readingAt, fieldNotes: expect.stringContaining('## Key ideas') });
    expect((await readCapture('expeditions')).find(({ id }) => id !== first!.id)?.endedAt).toBeNull();

    const panel = await openExtensionPage('sidepanel.html');
    await expect(panel.getByRole('heading', { name: 'Field notes' })).toBeVisible();
  });
});
