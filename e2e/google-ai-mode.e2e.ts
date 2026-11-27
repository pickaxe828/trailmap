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
      : url.searchParams.get('udm') === '50' ? 'ai-mode' : 'ai-overview';
    return route.fulfill({ path: join(snapshots, `${name}.html`), contentType: 'text/html' });
  });
}

async function ask(page: Page, question: string) {
  const input = page.getByRole('textbox', { name: 'Ask anything' });
  await input.fill('');
  await input.pressSequentially(question);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('Google results and passive AI Mode never store reply text; a broken typed reply leaves only its question', async ({
  context, readCapture, openExtensionPage,
}) => {
  await routeGoogle(context);
  const google = await context.newPage();
  const ordinaryUrl = `${GOOGLE}/search?q=why+is+the+sky+blue`;
  await google.goto(ordinaryUrl);
  await expect.poll(() => readCapture('queries')).toMatchObject([{ q: 'why is the sky blue' }]);
  await google.getByText('Overview-only answer about the atmosphere.').selectText();
  await google.keyboard.press('ControlOrMeta+c');
  await google.getByRole('link', { name: 'AI Mode' }).click();
  await expect(google.getByText('Air scatters shorter wavelengths more strongly.')).toBeVisible();
  const composer = google.getByRole('textbox', { name: 'Ask anything' });
  await composer.pressSequentially('Unsent draft');
  const settings = await openExtensionPage('settings.html#diagnostics');
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
  await expect(settings.getByText('AI Mode reply extraction failures: 1')).toBeVisible();
  expect(await readCapture('sentToModel')).toEqual([]);
  expect(JSON.stringify(await readCapture('pages'))).not.toMatch(/Unsent draft|Sidebar junk|Overview-only answer/);
  const diagnostics = settings.locator('#diagnostics');
  if (process.env.PROOF_DIR) await diagnostics.screenshot({ path: join(process.env.PROOF_DIR, 'diagnostics.png') });
  await settings.getByRole('tab', { name: 'Privacy' }).click();
  await settings.locator('#privacy').getByRole('textbox', { name: 'Site to skip' }).fill('google.com');
  await settings.locator('#privacy').getByRole('button', { name: /add site/i }).click();
  await expect.poll(() => readCapture('pages')).toEqual([]);
  await ask(google, NEXT);
  await expect(google.getByText('Rayleigh scattering explains', { exact: false })).toBeVisible();
  expect(await readCapture('visits')).toEqual([]);
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
