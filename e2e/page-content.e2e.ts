import { createHash } from 'node:crypto';
import { expect, test } from './fixtures';

test('search URLs record a Query linked to each search Visit', async ({ context, readCapture }) => {
  const searches = [
    ['https://www.google.com/search?q=crdt+deletes', 'google', 'crdt deletes'],
    ['https://www.bing.com/search?q=vector+clocks', 'bing', 'vector clocks'],
    ['https://duckduckgo.com/?q=causal+history', 'duckduckgo', 'causal history'],
    ['https://kagi.com/search?q=distributed+systems', 'kagi', 'distributed systems'],
    ['https://www.youtube.com/results?search_query=database+internals', 'youtube', 'database internals'],
    ['https://en.wikipedia.org/w/index.php?search=logical+clock', 'wikipedia', 'logical clock'],
  ] as const;
  const page = await context.newPage();
  await page.route('**/*', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Fixture search results</title><h1>Search results</h1>',
  }));
  for (const [url] of searches) await page.goto(url);

  await expect.poll(async () => (await readCapture('queries')).length).toBe(searches.length);
  const queries = await readCapture('queries');
  const visits = await readCapture('visits');
  for (const [url, engine, q] of searches) {
    const visit = visits.find((row) => row.url === url);
    expect(visit).toMatchObject({ transition: 'search', parentVisitId: null });
    expect(queries).toContainEqual(expect.objectContaining({ visitId: visit?.id, engine, q, at: visit?.startedAt }));
  }
});

test('an article stores capped Readability text under its canonical URL and skips password pages', async ({
  context, fixtureUrl, readCapture,
}) => {
  const privatePage = await context.newPage();
  const privateUrl = fixtureUrl('learn.test', '/content/article.html?private=1');
  await privatePage.goto(privateUrl);
  await expect(privatePage.getByLabel('Password')).toBeAttached();

  const page = await context.newPage();
  const url = fixtureUrl('learn.test', '/content/article.html?fbclid=test&sid=fixture');
  await page.goto(url);

  const canonicalUrl = fixtureUrl('learn.test', '/replicated-lists?chapter=2');
  await expect.poll(async () => (await readCapture('pages')).map((row) => row.canonicalUrl)).toEqual([canonicalUrl]);
  const [article] = await readCapture('pages');
  expect(article!.text).toContain('Tombstones preserve causal history across replicas.');
  expect(article!.text).not.toContain('This paragraph appears after the extraction limit.');
  expect(new TextEncoder().encode(article!.text).length).toBeLessThanOrEqual(12_000);
  expect(article!.textHash).toBe(createHash('sha256').update(article!.text).digest('hex'));

  const visits = await readCapture('visits');
  expect(visits.find((visit) => visit.url === url)?.canonicalUrl).toBe(canonicalUrl);
  expect(visits.some((visit) => visit.url === privateUrl)).toBe(false);
});

test('a Visit keeps its maximum scroll depth and links selections and copies to its Page', async ({
  context, fixtureUrl, readCapture, readVisits,
}) => {
  const page = await context.newPage();
  const url = fixtureUrl('learn.test', '/content/article.html');
  const canonicalUrl = fixtureUrl('learn.test', '/replicated-lists?chapter=2');
  await page.goto(url);
  const selection = page.locator('#highlight');
  const selectedText = await selection.innerText();
  await selection.selectText();
  await expect.poll(async () => (await readCapture('highlights')).map((row) => row.text)).toEqual([selectedText]);

  await page.locator('#short-copy').selectText();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(async () => (await readCapture('highlights')).length).toBe(2);

  await page.evaluate(() => {
    window.scrollTo(0, document.scrollingElement!.scrollHeight);
  });
  const depth = async () => (await readVisits()).find((visit) => visit.url === url)?.scrollDepth;
  await expect.poll(depth).toBe(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(async () => (await readCapture('pages')).find((row) => row.canonicalUrl === canonicalUrl)?.textHash)
    .toMatch(/^[0-9a-f]{64}$/);
  expect(await depth()).toBe(1);

  const visit = (await readVisits()).find((row) => row.url === url)!;
  expect(await readCapture('highlights')).toEqual(expect.arrayContaining([
    expect.objectContaining({ visitId: visit.id, canonicalUrl, source: 'selection', text: selectedText }),
    expect.objectContaining({ visitId: visit.id, canonicalUrl, source: 'copy', text: 'Replica' }),
  ]));
});

test('an SPA navigation captures the new route under its own canonical URL', async ({ context, fixtureUrl, readCapture }) => {
  const page = await context.newPage();
  const firstCanonical = fixtureUrl('learn.test', '/replicated-lists?chapter=2');
  const nextCanonical = fixtureUrl('learn.test', '/replicated-lists?chapter=3');
  await page.goto(fixtureUrl('learn.test', '/content/article.html'));
  await expect.poll(async () => (await readCapture('pages')).map((row) => row.canonicalUrl)).toEqual([firstCanonical]);

  const nextText = 'A logical clock helps a replica put causally related operations in order.';
  await page.evaluate((text) => {
    document.querySelector('#highlight')!.textContent = text;
    document.querySelector('link[rel=canonical]')!.setAttribute('href', '/replicated-lists?chapter=3');
    history.pushState({}, '', '/content/article.html?route=3');
  }, nextText);

  await expect.poll(async () => (await readCapture('pages')).find((row) => row.canonicalUrl === nextCanonical)?.text)
    .toContain(nextText);
  const visits = await readCapture('visits');
  expect(visits.find((visit) => visit.url.endsWith('?route=3'))?.canonicalUrl).toBe(nextCanonical);
});
