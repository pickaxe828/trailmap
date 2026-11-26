import { expect, test } from './fixtures';

const crdtSearch = 'crdt replication';
const gardeningSearch = 'indoor gardening';
const relatedSearch = 'crdt tombstones';
const searchUrl = (query: string) => 'https://www.google.com/search?q=' + encodeURIComponent(query);

test('two topics stay separate and related searches and linked pages join after a service worker restart', async ({
  context, extensionId, fixtureUrl, openExtensionPage, readCapture, serviceWorker,
}, testInfo) => {
  const articleUrl = fixtureUrl('learn.test', '/trail/article.html');
  await context.route('https://www.google.com/search?*', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Search results</title><a href="${articleUrl}">Read about replication</a>`,
  }));

  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 660 });

  const research = await context.newPage();
  await research.goto(searchUrl(crdtSearch));
  const gardening = await context.newPage();
  await gardening.goto(searchUrl(gardeningSearch));
  await expect(panel.getByRole('heading', { name: crdtSearch })).toBeVisible();
  await expect(panel.getByRole('heading', { name: gardeningSearch })).toBeVisible();

  const cdp = await context.newCDPSession(panel);
  const running = new Set<string>();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const { versionId, runningStatus, scriptURL } of versions) {
      if (!scriptURL.startsWith(`chrome-extension://${extensionId}/`)) continue;
      if (runningStatus === 'running') running.add(versionId);
      else running.delete(versionId);
    }
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => running.size).toBe(1);
  await cdp.send('ServiceWorker.stopWorker', { versionId: [...running][0]! });
  await expect.poll(() => running.size).toBe(0);

  await research.getByRole('link', { name: 'Read about replication' }).click();
  const followUp = await context.newPage();
  await followUp.goto(searchUrl(relatedSearch));

  const crdt = panel.getByRole('tree', { name: crdtSearch });
  const garden = panel.getByRole('tree', { name: gardeningSearch });
  await expect(crdt.getByText('Trail article')).toBeVisible();
  await expect(garden.getByText('Trail article')).toHaveCount(0);
  await expect.poll(async () => {
    const queries = await readCapture('queries');
    const expedition = queries.find(({ q }) => q === crdtSearch)?.expeditionId;
    const visits = await readCapture('visits');
    return {
      assigned: Boolean(expedition),
      related: queries.find(({ q }) => q === relatedSearch)?.expeditionId === expedition,
      gardening: queries.find(({ q }) => q === gardeningSearch)?.expeditionId !== expedition,
      linked: visits.find(({ url }) => url === articleUrl)?.expeditionId === expedition,
    };
  }).toEqual({ assigned: true, related: true, gardening: true, linked: true });
  await panel.screenshot({ path: testInfo.outputPath('open-expeditions.png') });

  // Headless Chromium cannot generate a genuine system idle period.
  // Seed the deadline the idle listener would have saved and fire the real alarm.
  await (await serviceWorker()).evaluate(async () => {
    await chrome.storage.session.set({ 'trailmap.expeditionIdleDeadline': Date.now() });
    await chrome.alarms.create('trailmap.expedition-close', { when: Date.now() + 100 });
  });
  await expect(panel.getByRole('heading', { name: 'Open expeditions' })).toHaveCount(0);
  await expect(panel.getByRole('tree', { name: 'Today' }).getByText('Trail article')).toBeVisible();
});

test.describe('real local Embedder integration', () => {
  test.use({ realEmbedder: true });
  test.skip(process.env.TRAILMAP_REAL_MINILM !== '1' || !!process.env.CI, 'Manual MiniLM smoke test; not part of CI');

  test('offscreen MiniLM returns normalized vectors and caches model files', async ({ serviceWorker }) => {
    const worker = await serviceWorker();
    const result = await worker.evaluate(async () => {
      const url = chrome.runtime.getURL('offscreen.html');
      const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
      if (!existing.length) {
        await chrome.offscreen.createDocument({
          url, reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Verify local Trailmap embeddings',
        });
      }
      return await chrome.runtime.sendMessage({
        type: 'trailmap.embed',
        texts: ['CRDT tombstones for distributed deletes', 'Deleting data with a conflict-free replicated data type',
          'How to bake sourdough bread'],
      });
    }) as { ok: true; vectors: number[][] } | { ok: false; error: string };

    test.skip(!result.ok && result.error === 'model-download', 'MiniLM model files could not be downloaded from Hugging Face');
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    expect(result.vectors).toHaveLength(3);
    for (const vector of result.vectors) {
      expect(vector).toHaveLength(384);
      expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
    }
    const [root, related, unrelated] = result.vectors;
    const dot = (other: number[]) => root!.reduce((sum, value, i) => sum + value * other[i]!, 0);
    expect(dot(related!)).toBeGreaterThan(dot(unrelated!) + 0.2);

    const cached = await worker.evaluate(async () => (await (await caches.open('transformers-cache')).keys())
      .map(({ url }) => url));
    expect(cached.some((url) => url.endsWith('/onnx/model_quantized.onnx'))).toBe(true);
  });
});
