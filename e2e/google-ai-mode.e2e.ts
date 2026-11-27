import type { BrowserContext, Page } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import { signInToMockChatGpt, test as modelTest } from './model-fixtures';

const GOOGLE = 'https://www.google.com';
const FIRST = 'Why is the sky blue?';
const NEXT = 'What is Rayleigh scattering?';
const BROKEN = 'Where did the answer go?';
const CITATION = 'https://science.test/light.html';
const snapshots = fileURLToPath(new URL('site/google/', import.meta.url));

async function routeGoogle(context: BrowserContext) {
  await context.route(`${GOOGLE}/**`, (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname === '/aimode' ? 'ai-mode-landing'
      : (url.searchParams.get('udm') === '50' || url.searchParams.has('mstk')) ? 'ai-mode' : 'ai-overview';
    return route.fulfill({ path: join(snapshots, `${name}.html`), contentType: 'text/html' });
  });
}

async function ask(page: Page, question: string) {
  const input = page.getByRole('textbox', { name: 'Ask anything' });
  await input.fill('');
  await input.pressSequentially(question);
  await page.getByRole('button', { name: 'Send' }).click();
}

modelTest('AI Mode shows the same page note editor after a conversation is captured', async ({
  context, openExtensionPage, installCompanion, aiModeScreened, readCapture,
}) => {
  await routeGoogle(context);
  installCompanion();
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 820 });
  const google = await context.newPage();
  await google.goto(`${GOOGLE}/aimode`);
  await aiModeScreened();
  const thisPage = panel.getByRole('region', { name: 'This page' });
  await expect(thisPage.getByText('Ask a question in AI Mode to start recording this conversation.')).toBeVisible();
  await ask(google, FIRST);
  const conversation = async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns);
  await expect.poll(conversation, { timeout: 0 }).toMatchObject({ aiTurns: [{ question: FIRST, answer: expect.stringContaining('Air scatters') }] });
  await ask(google, NEXT);
  await expect.poll(conversation, { timeout: 0 }).toMatchObject({ summary: 'The AI conversation explains Rayleigh scattering.' });
  const note = thisPage.getByRole('textbox', { name: 'Page note' });
  const text = '**Rayleigh scattering**\n\nFind a source that explains the wavelength dependence.';
  await note.fill(text);
  await expect(thisPage.getByRole('status')).toHaveText('Saved');
  const ai = (await readCapture('visits')).find(({ aiConversation }) => aiConversation);
  expect(await readCapture('notes')).toMatchObject([{ nodeId: ai?.id, text }]);
  await expect(thisPage.getByRole('button', { name: 'Generated page notes' })).toHaveAttribute('aria-expanded', 'false');
  const dir = process.env.NOTES_PROOF_DIR;
  if (dir) for (const colorScheme of ['light', 'dark'] as const) {
    await panel.emulateMedia({ colorScheme });
    await panel.screenshot({ path: join(dir, `google-ai-mode-note-saved-${colorScheme}.png`), animations: 'disabled' });
  }
});

test('Google results and passive AI Mode never store reply text; a broken typed reply leaves only its question', async ({
  context, readCapture, openExtensionPage, aiModeScreened,
}) => {
  await routeGoogle(context);
  const google = await context.newPage();
  const ordinaryUrl = `${GOOGLE}/search?q=why+is+the+sky+blue`;
  await google.goto(ordinaryUrl);
  await expect.poll(() => readCapture('queries')).toMatchObject([{ q: 'why is the sky blue' }]);
  await google.getByText('Overview-only answer about the atmosphere.').selectText();
  await google.keyboard.press('ControlOrMeta+c');
  // This untrusted navigation preserves the Search parent but doesn't start a conversation.
  await google.getByRole('link', { name: 'AI Mode', exact: true }).evaluate((link: HTMLElement) => link.click());
  await aiModeScreened();
  await expect(google.getByText('Air scatters shorter wavelengths more strongly.')).toBeVisible();
  const composer = google.getByRole('textbox', { name: 'Ask anything' });
  await composer.pressSequentially('Unsent draft');
  const settings = await openExtensionPage('settings.html#diagnostics');
  await expect(settings.getByText('AI Mode reply extraction successes: 0')).toBeVisible();
  await expect(settings.getByText('AI Mode reply extraction failures: 0')).toBeVisible();
  expect(await readCapture('pages')).toEqual([]);
  expect(await readCapture('highlights')).toEqual([]);
  expect((await readCapture('visits')).map(({ url }) => url)).toEqual([ordinaryUrl]);

  await ask(google, FIRST); // Same text as the already-present passive reply.
  const transcript = async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns)?.aiTurns;
  await expect.poll(transcript).toMatchObject([{ question: FIRST, answer: 'Molecules scatter blue light more than red light.' }]);
  const visits = await readCapture('visits');
  const search = visits.find(({ url }) => url === ordinaryUrl);
  expect(visits.filter(({ aiConversation }) => aiConversation)).toMatchObject([{ parentVisitId: search?.id, engagement: 'skimmed' }]);

  await ask(google, BROKEN);
  await expect.poll(transcript).toMatchObject([
    { question: FIRST, answer: 'Molecules scatter blue light more than red light.' },
    { question: BROKEN, answer: null, citations: [], extractionFailed: true },
  ]);
  await expect(settings.getByText('AI Mode reply extraction successes: 1')).toBeVisible();
  await expect(settings.getByText('AI Mode reply extraction failures: 1')).toBeVisible();
  expect(await readCapture('sentToModel')).toEqual([]);
  expect(JSON.stringify(await readCapture('pages'))).not.toMatch(/Unsent draft|Sidebar junk|Overview-only answer/);
  const diagnostics = settings.locator('#diagnostics');
  if (process.env.PROOF_DIR) await diagnostics.screenshot({ path: join(process.env.PROOF_DIR, 'diagnostics.png') });
  await settings.getByRole('tab', { name: 'Privacy' }).click();
  await settings.locator('#privacy').getByRole('textbox', { name: 'Site to skip' }).fill('google.com');
  await settings.locator('#privacy').getByRole('button', { name: /add site/i }).click();
  await expect.poll(() => readCapture('pages')).toEqual([]);
  await settings.getByRole('tab', { name: 'Diagnostics' }).click();
  await expect(settings.getByText('AI Mode reply extraction successes: 1')).toBeVisible();
  await expect(settings.getByText('AI Mode reply extraction failures: 1')).toBeVisible();
  await ask(google, NEXT);
  await expect(google.getByText('Rayleigh scattering explains', { exact: false })).toBeVisible();
  expect(await readCapture('visits')).toEqual([]);
});

test('entering AI Mode from a recorded Google Query starts a child stop and enables page notes', async ({
  context, readCapture, openExtensionPage, aiModeScreened,
}) => {
  await routeGoogle(context);
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 850 });
  const google = await context.newPage();
  const q = 'q=Why+is+the+sky+blue%3F';
  const search = `${GOOGLE}/search?${q}`;
  const mode = `${search}&mstk=fixture-mode-marker`;
  const thisPage = panel.getByRole('region', { name: 'This page' });
  const pending = thisPage.getByText('Ask a question in AI Mode to start recording this conversation.');
  const getTranscript = async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns)?.aiTurns;
  await google.goto(search);
  await expect.poll(() => readCapture('queries')).toHaveLength(1);
  await google.getByRole('link', { name: 'AI Mode', exact: true }).click();
  await expect(google).toHaveURL(mode);
  await expect.poll(getTranscript, { timeout: 0 }).toMatchObject([{ question: FIRST, answer: expect.stringContaining('Air scatters') }]);
  const visits = await readCapture('visits');
  const [ai] = visits.filter(({ aiConversation }) => aiConversation);
  const parent = visits.find(({ id }) => id === ai?.parentVisitId);
  expect(parent?.url).toBe(search);
  expect(JSON.stringify(visits)).not.toContain('fixture-mode-marker');
  await expect(thisPage.getByRole('textbox', { name: 'Page note' })).toBeVisible();
  await expect(thisPage.getByRole('heading', { name: 'Google AI Mode · AI-generated' })).toBeVisible();
  if (process.env.AI_MODE_PROOF_DIR) for (const colorScheme of ['light', 'dark'] as const) {
    await panel.emulateMedia({ colorScheme });
    await panel.screenshot({ path: join(process.env.AI_MODE_PROOF_DIR, `search-to-ai-mode-400-${colorScheme}.png`), animations: 'disabled' });
  }

  // A script-triggered click reaches the same URL, but it is not permission to capture.
  await google.goto(search);
  await expect.poll(() => readCapture('queries')).toHaveLength(2);
  await google.getByRole('link', { name: 'AI Mode', exact: true }).evaluate((link: HTMLElement) => link.click());
  await expect(google).toHaveURL(mode);
  await aiModeScreened();
  await expect(pending).toBeVisible();
  expect((await readCapture('visits')).filter(({ aiConversation }) => aiConversation)).toHaveLength(1);
  await google.reload();
  await aiModeScreened();
  await expect(pending).toBeVisible();
  expect((await readCapture('visits')).filter(({ aiConversation }) => aiConversation)).toHaveLength(1);
});

test('a saved-page AI Mode conversation shows all three answers and the latest follow-up in the live trail', async ({
  context, aiModeScreened, readCapture, openExtensionPage,
}) => {
  await context.route(`${GOOGLE}/**`, (route) => route.fulfill({
    path: join(snapshots, new URL(route.request().url()).pathname === '/aimode' ? 'ai-mode-landing.html' : 'ai-mode-saved.html'),
    contentType: 'text/html',
  }));
  const google = await context.newPage();
  await google.addInitScript(() => {
    // Replay the saved conversation one turn at a time. The fixture itself has no scripts.
    document.addEventListener('DOMContentLoaded', () => {
      const thread = document.querySelector('[jsname="RH7zg"] > div > div');
      if (!thread) return;
      const [typed, suggested] = Array.from(thread.children);
      typed!.remove();
      suggested!.remove();
      function addTurn(question: string, reply: Element) {
        const url = new URL(location.href);
        url.searchParams.set('q', question);
        history.pushState({}, '', url);
        thread!.append(reply);
      }
      const composer = document.querySelector('textarea')!;
      document.querySelector('button[aria-label="Send"]')!.addEventListener('click', () => {
        const question = composer.value;
        if (question === 'How about heme?') addTurn(question, typed!);
        composer.value = '';
      });
      typed!.querySelector('[role="link"]')!.addEventListener('click', (event) => {
        if (event.isTrusted) addTurn('vitamin B12', suggested!);
      });
    });
  });
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 400, height: 820 });
  await google.goto(`${GOOGLE}/aimode`);
  await aiModeScreened();
  await ask(google, 'how did myoglobin evolve');
  const transcript = async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns)?.aiTurns;
  const first = { question: 'how did myoglobin evolve', answer: expect.stringContaining('Myoglobin evolved from ancestral globins') };
  const second = { question: 'How about heme?', answer: expect.stringContaining('Heme is the iron-containing group') };
  const third = { question: 'vitamin B12', answer: expect.stringContaining('Vitamin B12 contains cobalt') };
  await expect.poll(transcript, { timeout: 0 }).toMatchObject([first]);
  await ask(google, second.question);
  await expect.poll(transcript, { timeout: 0 }).toMatchObject([first, second]);
  const suggestion = google.getByRole('link', { name: 'vitamin B12', exact: true });
  await suggestion.dispatchEvent('click'); // A page-script click is not consent.
  await suggestion.click();
  await expect.poll(transcript, { timeout: 0 }).toMatchObject([first, second, third]);

  const summary = panel.getByText('3 questions · Latest: vitamin B12', { exact: true });
  await expect(summary).toBeVisible();
  const [visit] = (await readCapture('visits')).filter(({ aiConversation }) => aiConversation);
  expect(visit?.expeditionId).toBeTruthy();
  const detail = await openExtensionPage(`expedition.html?id=${visit!.expeditionId}&stop=${visit!.id}`);
  await detail.setViewportSize({ width: 1280, height: 900 });
  const stop = detail.getByRole('region', { name: 'Trail stop details' });
  for (const { question } of [first, second, third]) await expect(stop.getByText(question, { exact: true })).toBeVisible();
  for (const answer of ['Myoglobin evolved from ancestral globins', 'Heme is the iron-containing group', 'Vitamin B12 contains cobalt']) {
    await expect(stop.getByText(answer, { exact: false })).toBeVisible();
  }
  if (process.env.AI_MODE_PROOF_DIR) {
    await google.bringToFront();
    await expect(panel.getByRole('region', { name: 'This page' }).getByRole('textbox', { name: 'Page note' })).toBeVisible();
    await summary.scrollIntoViewIfNeeded();
    for (const colorScheme of ['light', 'dark'] as const) {
      await detail.emulateMedia({ colorScheme });
      await panel.emulateMedia({ colorScheme });
      await panel.screenshot({ path: join(process.env.AI_MODE_PROOF_DIR, `sidepanel-400-${colorScheme}.png`), animations: 'disabled' });
      await detail.screenshot({ path: join(process.env.AI_MODE_PROOF_DIR, `expedition-1280-${colorScheme}.png`), animations: 'disabled' });
    }
  }
});

modelTest('the first typed AI Mode question and same-page follow-up share one enriched, forgettable conversation', async ({
  context, readCapture, openExtensionPage, installCompanion, mockOrigin, aiModeScreened,
}) => {
  await routeGoogle(context);
  await context.route(CITATION, (route) => route.fulfill({ body: '<title>Light and scattering</title><p>Read this cited page.</p>', contentType: 'text/html' }));
  installCompanion();
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const google = await context.newPage();
  await google.goto(`${GOOGLE}/aimode`);
  // A question typed before the recorder screens the document is dropped by design.
  await aiModeScreened();
  await ask(google, FIRST);
  const conversation = async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns);
  // Persisted turns signal that capture completed; the test deadline is the only time bound.
  await expect.poll(conversation, { timeout: 0, message: 'first AI Mode turn is captured with its citation' })
    .toMatchObject({ aiTurns: [{ question: FIRST, answer: expect.stringContaining('Air scatters'), citations: [CITATION] }] });
  await ask(google, NEXT);
  await expect.poll(conversation, { timeout: 0, message: 'the AI Mode follow-up is captured and enriched' })
    .toMatchObject({ summary: 'The AI conversation explains Rayleigh scattering.', aiTurns: [
      { question: FIRST, answer: expect.stringContaining('Air scatters'), citations: [CITATION] },
      { question: NEXT, answer: expect.stringContaining('Rayleigh scattering explains'), citations: [] },
    ] });
  const visits = await readCapture('visits');
  const ai = visits.filter(({ aiConversation }) => aiConversation);
  expect(ai).toHaveLength(1);
  const [visit] = ai;
  const [query] = await readCapture('queries');
  expect(query).toMatchObject({ q: FIRST, visitId: visit!.parentVisitId });
  expect(visit).toMatchObject({ engagement: 'read', expeditionId: query!.expeditionId });
  expect(visit!.expeditionId).toBeTruthy();
  expect(JSON.stringify(visits)).not.toContain('fixture-session-token');

  const detail = await openExtensionPage(`expedition.html?id=${visit!.expeditionId}&stop=${visit!.id}`);
  await expect(detail.getByText('AI conversation · AI-generated answers, not an independent source.')).toBeVisible();
  await expect(detail.getByText(NEXT, { exact: true })).toBeVisible();
  if (process.env.PROOF_DIR) await detail.getByRole('region', { name: 'Trail stop details' }).screenshot({ path: join(process.env.PROOF_DIR, 'ai-conversation.png') });
  const sourceTab = context.waitForEvent('page');
  await detail.getByRole('link', { name: /science\.test\/light\.html/ }).click();
  await expect((await sourceTab).getByText('Read this cited page.')).toBeVisible();
  await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === CITATION))
    .toMatchObject({ parentVisitId: visit!.id, transition: 'new-tab' });

  const panel = await openExtensionPage('sidepanel.html');
  await panel.getByRole('button', { name: /Wrap up expedition/ }).click();
  const fieldNotes = async () => (await readCapture('expeditions')).find(({ id }) => id === visit!.expeditionId)?.fieldNotes;
  await expect.poll(fieldNotes).toContain('AI-generated; not a source');
  const notesPane = detail.getByRole('region', { name: 'Field notes' });
  await expect(notesPane.getByText('Includes AI-generated material', { exact: false })).toBeVisible();
  if (process.env.PROOF_DIR) await notesPane.screenshot({ path: join(process.env.PROOF_DIR, 'field-notes.png') });
  await expect.poll(async () => (await readCapture('conceptEvidence')).some(({ visitId }) => visitId === visit!.id)).toBe(true);
  await expect.poll(async () => (await readCapture('edges')).find(({ type }) => type === 'related_to'))
    .toMatchObject({ evidence: [visit!.id] });
  const atlas = await openExtensionPage('atlas.html');
  await atlas.getByRole('combobox', { name: 'Find a concept' }).fill('Rayleigh scattering');
  await atlas.getByRole('option', { name: 'Rayleigh scattering', exact: true }).click();
  await expect(atlas.getByRole('heading', { name: 'Rayleigh scattering', exact: true })).toBeVisible();
  await expect(atlas.getByText('AI-generated, not an independent source')).toBeVisible();
  const attempts = await (await fetch(mockOrigin + '/test/calls')).json() as { input: { content: string }[] }[];
  const transcriptPrompt = attempts.find(({ input }) => input[0]?.content.includes(`User question (what I wanted to learn): ${NEXT}`));
  expect(transcriptPrompt?.input[0]?.content).toContain('AI-generated answer: Air scatters');
  expect(JSON.stringify(attempts)).not.toMatch(/Source side panel|Overview-only answer|Related image caption/);
  await expect.poll(async () => (await readCapture('sentToModel')).filter(({ visitIds }) => visitIds?.includes(visit!.id)).length).toBeGreaterThan(0);

  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Actions for Google AI Mode · AI-generated' }).click();
  // Playwright can scroll the panel during a pointer click and move this anchored menu out from under it.
  const forget = panel.getByRole('menuitem', { name: 'Forget AI conversation' });
  await expect(forget).toBeVisible();
  await forget.press('Enter');
  await panel.getByRole('alertdialog').getByRole('button', { name: 'Forget AI conversation', exact: true }).click();
  await expect.poll(conversation).toBeUndefined();
  expect(await readCapture('queries')).toEqual([]);
  expect((await readCapture('conceptEvidence')).filter(({ visitId }) => visitId === visit!.id)).toEqual([]);
  expect((await readCapture('sentToModel')).filter(({ visitIds }) => visitIds?.includes(visit!.id))).toEqual([]);
  expect((await readCapture('visits')).find(({ url }) => url === CITATION)?.parentVisitId).toBeNull();
  expect(await fieldNotes()).toBeNull();
});
