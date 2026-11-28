import { FIXTURE_PORT } from './constants';
import { expect, test } from './fixtures';
import { signInToMockChatGpt, test as modelTest } from './model-fixtures';

// PDFs are served by the fixture server on a fake host (never a real one). Chromium's viewer is a cross-origin
// frame the content script can't read, so the extension re-fetches the same URL: the fixture server records who asked.
const pdf = (path: string) => `http://learn.test:${FIXTURE_PORT}/pdf/${path}`;
const PAPER = pdf('paper.pdf');
const MEMTABLE = 'Log-structured merge trees buffer writes in a memtable.';
const COMPACTION = 'Compaction merges sorted runs and discards overwritten keys.';

type Requests = { path: string; accept: string | null; cookie: boolean }[];
const requests = async (): Promise<Requests> => (await fetch(`http://127.0.0.1:${FIXTURE_PORT}/__pdf-requests`)).json();
// The browser's own navigation asks for text/html first; a fetch() from the extension accepts anything.
const refetches = async (path: string) => (await requests()).filter((request) => request.path === path && request.accept === '*/*');
const pageFor = async (readCapture: (table: 'pages') => Promise<{ canonicalUrl: string; text: string }[]>, url: string) =>
  (await readCapture('pages')).find(({ canonicalUrl }) => canonicalUrl === url);

test('a PDF in the browser viewer is stored as a PDF Visit with the text of every page, from one re-fetch', async ({ context, readCapture }) => {
  const page = await context.newPage();
  await page.goto(PAPER);
  await expect.poll(async () => (await pageFor(readCapture, PAPER))?.text).toContain(COMPACTION);
  expect((await pageFor(readCapture, PAPER))!.text).toBe(`${MEMTABLE} A flush turns the memtable into an immutable sorted run. ${COMPACTION} Bloom filters keep point reads cheap.`);
  expect((await readCapture('visits')).find(({ url }) => url === PAPER)).toMatchObject({ pdf: true, title: 'LSM trees: a short paper' });
  expect(await refetches('/pdf/paper.pdf')).toHaveLength(1);
  // Opening it again does not read it again.
  await page.reload();
  await expect.poll(async () => (await readCapture('visits')).filter(({ url }) => url === PAPER).length).toBe(2);
  expect(await refetches('/pdf/paper.pdf')).toHaveLength(1);
});

test('a PDF whose URL does not end in .pdf is found by its content type', async ({ context, readCapture }) => {
  const url = pdf('download?id=7');
  const page = await context.newPage();
  await page.goto(url);
  await expect.poll(async () => (await pageFor(readCapture, url))?.text).toContain(COMPACTION);
  expect((await readCapture('visits')).find((visit) => visit.url === url)).toMatchObject({ pdf: true });
  expect(await refetches('/pdf/download')).toHaveLength(1);
});

test('a scanned PDF without a text layer keeps its title and no text', async ({ context, readCapture }) => {
  const url = pdf('scan.pdf');
  const page = await context.newPage();
  await page.goto(url);
  await expect.poll(async () => pageFor(readCapture, url)).toMatchObject({ text: '' });
  expect((await readCapture('visits')).find((visit) => visit.url === url)).toMatchObject({ pdf: true, title: 'Scanned lecture notes' });
  expect(await refetches('/pdf/scan.pdf')).toHaveLength(1);
});

test('the re-fetch carries the browser profile\'s cookies, so a PDF behind a sign-in is read', async ({ context, readCapture }) => {
  const url = pdf('private.pdf');
  await context.addCookies([{ name: 'session', value: 'ok', url }]);
  const page = await context.newPage();
  await page.goto(url);
  await expect.poll(async () => (await pageFor(readCapture, url))?.text).toContain('Members only: a tombstone records that an item was deleted.');
  expect((await refetches('/pdf/private.pdf'))[0]).toMatchObject({ cookie: true });
});

test('paused recording and a skipped site never open, read or fetch a PDF', async ({ context, fixtureUrl, openExtensionPage, readCapture }) => {
  // The fixture server is shared by every test in the run, so count from here.
  const [paperBefore, scanBefore] = [(await refetches('/pdf/paper.pdf')).length, (await refetches('/pdf/scan.pdf')).length];
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 640 });
  const page = await context.newPage();
  await page.goto(fixtureUrl('learn.test', '/trail/start.html'));
  await expect.poll(async () => (await readCapture('visits')).length).toBe(1);
  const recorded = async (suffix: string) => (await readCapture('visits')).some(({ url }) => url.endsWith(suffix));

  const recording = panel.getByRole('switch', { name: 'Record browsing' });
  await expect(recording).toBeChecked();
  await recording.evaluate((input: HTMLInputElement) => input.click());
  await expect(recording).not.toBeChecked();
  await page.goto(PAPER);
  await page.goto(fixtureUrl('learn.test', '/content/article.html'));
  await recording.evaluate((input: HTMLInputElement) => input.click());
  await expect(recording).toBeChecked();
  await page.goto(fixtureUrl('learn.test', '/trail/article.html'));
  await expect.poll(() => recorded('/trail/article.html')).toBe(true);
  expect(await recorded('/pdf/paper.pdf')).toBe(false);
  expect((await refetches('/pdf/paper.pdf')).length).toBe(paperBefore);

  // Recorded, then skipped: the Visit and its text are purged and a revisit stores and fetches nothing.
  await page.goto(PAPER);
  await expect.poll(async () => (await pageFor(readCapture, PAPER))?.text).toContain(MEMTABLE);
  await page.bringToFront();
  const site = panel.getByRole('switch', { name: 'Record learn.test' });
  await expect(site).toBeChecked();
  await site.evaluate((input: HTMLInputElement) => input.click());
  await expect(site).not.toBeChecked();
  await expect.poll(() => recorded('/pdf/paper.pdf')).toBe(false);
  const fetched = (await refetches('/pdf/paper.pdf')).length;
  expect(fetched).toBe(paperBefore + 1); // The recorded read, before the site was skipped.
  await page.goto(PAPER);
  await page.goto(pdf('scan.pdf'));
  await page.goto(fixtureUrl('learn.test', '/content/article.html'));
  await expect.poll(async () => (await readCapture('pages')).length).toBe(0);
  expect((await refetches('/pdf/paper.pdf')).length).toBe(fetched);
  expect((await refetches('/pdf/scan.pdf')).length).toBe(scanBefore);
  expect(JSON.stringify(await Promise.all((['visits', 'pages', 'highlights', 'queries'] as const).map((table) => readCapture(table))))).not.toContain('memtable');
});

modelTest.describe('enrichment', () => {
  modelTest.use({ companionInstalled: true, controlledCaptureClock: true });

  modelTest('a PDF read for a minute is enriched from its text layer and logged as sent to the model', async ({
    context, openExtensionPage, readCapture, serviceWorker, mockOrigin,
  }) => {
    await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
    const page = await context.newPage();
    await page.goto(PAPER);
    await expect.poll(async () => (await pageFor(readCapture, PAPER))?.text).toContain(COMPACTION);
    // A minute of reading, on the capture clock: the next event settles it onto this tab's Visit.
    const worker = await serviceWorker();
    await worker.evaluate(() => { (globalThis as typeof globalThis & { captureTestTime: number }).captureTestTime += 60_000; });
    const other = await context.newPage();
    await other.goto(`http://learn.test:${FIXTURE_PORT}/trail/start.html`);

    await expect.poll(async () => (await pageFor(readCapture, PAPER) as { pageKind?: string } | undefined)?.pageKind, { timeout: 45_000 }).toBe('paper');
    expect((await readCapture('pages')).find(({ canonicalUrl }) => canonicalUrl === PAPER)).toMatchObject({
      summary: expect.stringContaining('log-structured merge tree'), conceptMentions: [{ name: 'Compaction' }],
    });
    const calls = await (await fetch(mockOrigin + '/test/calls')).json() as { input: { content: string }[] }[];
    const sent = calls.map(({ input }) => JSON.parse(input[0]!.content) as { contentKind?: string; text?: string; url?: string }).filter(({ contentKind }) => contentKind === 'pdf');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: PAPER, text: expect.stringContaining(COMPACTION) });
    expect((await readCapture('sentToModel')).some(({ task }) => task === 'page_enrichment')).toBe(true);
  });
});
