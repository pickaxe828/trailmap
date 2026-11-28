import type { BrowserContext, Page } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import { signInToMockChatGpt, test as modelTest } from './model-fixtures';

// The capture rules key on the real host names, so (like the Google AI Mode tests) the fixtures answer those
// hosts through context.route. Nothing leaves the machine.
const sites = {
  chatgpt: { host: 'chatgpt.com', label: 'ChatGPT', start: '/', after: '/c/fixture-conversation' },
  claude: { host: 'claude.ai', label: 'Claude', start: '/new', after: '/chat/fixture-conversation' },
  gemini: { host: 'gemini.google.com', label: 'Gemini', start: '/app', after: '/app/fixture-conversation' },
} as const;
type Site = keyof typeof sites;
const fixtures = fileURLToPath(new URL('site/chat/', import.meta.url));
const FIRST = 'Why is the sky blue?';
const NEXT = 'What is Rayleigh scattering?';
const BROKEN = 'Where did the answer go?';
const HISTORY = 'Earlier question about tides';
const CITATION = 'https://science.test/light.html';

async function routeChat(context: BrowserContext) {
  for (const [site, { host }] of Object.entries(sites)) {
    await context.route(`https://${host}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      return path === '/driver.js'
        ? route.fulfill({ path: join(fixtures, 'driver.js'), contentType: 'text/javascript' })
        : route.fulfill({ path: join(fixtures, `${site}.html`), contentType: 'text/html' });
    });
  }
}

async function ask(page: Page, question: string) {
  const composer = page.locator('[data-composer]');
  await composer.click();
  await composer.pressSequentially(question);
  await page.keyboard.press('Enter');
}

const toggle = (settings: Page, site: Site) => settings.getByRole('switch', { name: `Capture conversations from ${sites[site].label}` });
async function setOptIn(settings: Page, site: Site, on: boolean) {
  await expect(toggle(settings, site)).toBeEnabled(); // Enabled once the stored settings have loaded.
  await toggle(settings, site).click(); // The switch follows the stored setting, so check() would race the save.
  if (on) await expect(toggle(settings, site)).toBeChecked();
  else await expect(toggle(settings, site)).not.toBeChecked();
}

test('with every opt-in off a chat is skipped: nothing typed, replied or selected is stored', async ({
  context, fixtureUrl, readCapture,
}) => {
  await routeChat(context);
  const chat = await context.newPage();
  await chat.goto(`https://chatgpt.com/`);
  await ask(chat, FIRST);
  await expect(chat.getByText('Molecules scatter blue light more than red light.')).toBeVisible();
  await chat.getByText('Molecules scatter blue light more than red light.').selectText();
  await chat.keyboard.press('ControlOrMeta+c');
  // A normal page's capture is the barrier: it proves the chat's events were handled first.
  const allowed = fixtureUrl('learn.test', '/content/article.html');
  await (await context.newPage()).goto(allowed);
  await expect.poll(async () => (await readCapture('visits')).map(({ url }) => url)).toEqual([allowed]);
  await expect.poll(async () => (await readCapture('pages')).map(({ canonicalUrl }) => new URL(canonicalUrl).hostname)).toEqual(['learn.test']);
  expect(await readCapture('highlights')).toEqual([]);
  expect(JSON.stringify([await readCapture('pages'), await readCapture('visits')])).not.toMatch(/blue light|sky blue|tides/);
});

for (const site of Object.keys(sites) as Site[]) {
  const { host, label, start, after } = sites[site];
  test(`${label}: after opting in, a typed turn and its reply are captured but the page history is not`, async ({
    context, readCapture, openExtensionPage, aiModeScreened,
  }) => {
    await routeChat(context);
    const chat = await context.newPage();
    await chat.goto(`https://${host}${start}`);
    // The page is already open, with older history in it and a draft being typed, when the user opts in.
    await chat.locator('[data-composer]').pressSequentially('A draft I typed before opting in');
    const settings = await openExtensionPage('settings.html');
    await expect(toggle(settings, site)).not.toBeChecked();
    await setOptIn(settings, site, true);
    await aiModeScreened();
    await chat.bringToFront();
    await chat.locator('[data-composer]').fill('');
    expect(await readCapture('visits')).toEqual([]); // Opting in records nothing by itself.

    await ask(chat, FIRST);
    const transcript = async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns)?.aiTurns;
    await expect.poll(transcript).toMatchObject([{ question: FIRST, answer: expect.stringContaining('Molecules scatter blue light'), citations: [CITATION] }]);
    await expect(chat).toHaveURL(`https://${host}${after}`); // The first message moved the page to its own conversation URL.
    await ask(chat, NEXT);
    await expect.poll(transcript).toMatchObject([{ question: FIRST }, { question: NEXT, answer: expect.stringContaining('Rayleigh scattering explains') }]);

    const visits = await readCapture('visits');
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ aiConversation: true, title: `${label} · AI-generated`, transition: 'typed', parentVisitId: null });
    const everything = JSON.stringify([visits, await readCapture('pages'), await readCapture('queries'), await readCapture('highlights')]);
    expect(everything).not.toMatch(new RegExp(`${HISTORY}|Earlier answer|draft I typed|Sources side panel|Hidden scratch|fixture-conversation`));
    expect(await readCapture('highlights')).toEqual([]);

    await ask(chat, BROKEN);
    await expect.poll(transcript).toMatchObject([{}, {}, { question: BROKEN, answer: null, citations: [] }]);
    // An unrecognizable reply is waited for; leaving the chat settles the turn as question only.
    await chat.close();
    await expect.poll(transcript).toMatchObject([{}, {}, { question: BROKEN, answer: null, citations: [], extractionFailed: true }]);
    await settings.goto(settings.url().split('#')[0] + '#diagnostics');
    await expect(settings.getByText(`${label} reply extraction failures: 1`)).toBeVisible();
    await expect(settings.getByText('AI Mode reply extraction failures: 0')).toBeVisible();
    expect(JSON.stringify(await readCapture('pages'))).not.toContain('layout nobody documented');
  });
}

test('opting in is per site, and turning a site off removes what it captured and stops capture', async ({
  context, readCapture, openExtensionPage, aiModeScreened,
}) => {
  await routeChat(context);
  const settings = await openExtensionPage('settings.html');
  await setOptIn(settings, 'chatgpt', true);
  const chatgpt = await context.newPage();
  await chatgpt.goto('https://chatgpt.com/');
  await aiModeScreened();
  await ask(chatgpt, FIRST);
  await expect.poll(async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns)?.aiTurns).toMatchObject([{ answer: expect.any(String) }]);

  // Another site is still off.
  const claude = await context.newPage();
  await claude.goto('https://claude.ai/new');
  await ask(claude, NEXT);
  await expect(claude.getByText('Rayleigh scattering explains')).toBeVisible();

  await settings.bringToFront();
  await setOptIn(settings, 'chatgpt', false);
  await expect.poll(async () => (await readCapture('visits')).length).toBe(0);
  expect(await readCapture('pages')).toEqual([]);
  await chatgpt.bringToFront();
  await ask(chatgpt, NEXT);
  await expect(chatgpt.getByText('Rayleigh scattering explains')).toBeVisible();
  // Settings is a normal extension page, so its own state is the barrier: nothing was recorded, for either site.
  expect(await readCapture('visits')).toEqual([]);
  expect(JSON.stringify(await readCapture('pages'))).not.toContain('Rayleigh');
});

test('a skipped site stops an opted-in chat', async ({ context, readCapture, openExtensionPage, aiModeScreened }) => {
  await routeChat(context);
  const settings = await openExtensionPage('settings.html');
  await setOptIn(settings, 'claude', true);
  const chat = await context.newPage();
  await chat.goto('https://claude.ai/new');
  await aiModeScreened();
  await ask(chat, FIRST);
  await expect.poll(async () => (await readCapture('visits')).length).toBe(1);

  await settings.bringToFront();
  const privacy = settings.locator('#privacy');
  await privacy.getByRole('textbox', { name: 'Site to skip' }).fill('claude.ai');
  await privacy.getByRole('button', { name: /add site/i }).click();
  await expect.poll(async () => (await readCapture('visits')).length).toBe(0);
  await chat.bringToFront();
  await ask(chat, NEXT);
  await expect(chat.getByText('Rayleigh scattering explains')).toBeVisible();
  expect(await readCapture('pages')).toEqual([]);
  // The opt-in itself is untouched, so removing the skip admits the page again on the next screen.
  await expect(toggle(settings, 'claude')).toBeChecked();
});

modelTest('a captured conversation reaches the model only through the privacy filter and the Sent-to-model log, and Forget removes it', async ({
  context, readCapture, openExtensionPage, installCompanion, mockOrigin, aiModeScreened,
}) => {
  await routeChat(context);
  installCompanion();
  const settings = await openExtensionPage('settings.html#model-providers');
  await signInToMockChatGpt(context, settings);
  await settings.goto(settings.url().split('#')[0] + '#privacy');
  await setOptIn(settings, 'chatgpt', true);
  await settings.setViewportSize({ width: 1280, height: 1100 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await settings.emulateMedia({ colorScheme });
    if (process.env.PROOF_DIR) await settings.locator('#privacy').getByRole('region', { name: 'Chat conversations' }).screenshot({ path: join(process.env.PROOF_DIR, `chat-capture-${colorScheme}.png`) });
  }
  await settings.emulateMedia({ colorScheme: null });

  const chat = await context.newPage();
  await chat.goto('https://chatgpt.com/');
  await aiModeScreened();
  await ask(chat, FIRST);
  await ask(chat, NEXT);
  const conversation = async () => (await readCapture('pages')).find(({ aiTurns }) => aiTurns);
  await expect.poll(conversation).toMatchObject({ summary: expect.any(String), aiTurns: [{ question: FIRST }, { question: NEXT, answer: expect.stringContaining('Rayleigh scattering explains') }] });
  const [visit] = await readCapture('visits');
  const attempts = await (await fetch(mockOrigin + '/test/calls')).json() as { input: { content: string }[] }[];
  const prompt = attempts.find(({ input }) => input[0]?.content.includes(`User question (what I wanted to learn): ${NEXT}`));
  expect(prompt?.input[0]?.content).toContain('AI-generated answer: Molecules scatter');
  expect(JSON.stringify(attempts)).not.toMatch(new RegExp(`${HISTORY}|Earlier answer|Sources side panel|Hidden scratch`));
  await expect.poll(async () => (await readCapture('sentToModel')).filter(({ visitIds }) => visitIds?.includes(visit!.id)).length).toBeGreaterThan(0);

  const panel = await openExtensionPage('sidepanel.html');
  await panel.getByRole('button', { name: 'Actions for ChatGPT · AI-generated' }).click();
  await panel.getByRole('menuitem', { name: 'Forget AI conversation' }).click();
  await panel.getByRole('alertdialog').getByRole('button', { name: 'Forget AI conversation', exact: true }).click();
  await expect.poll(conversation).toBeUndefined();
  expect(await readCapture('visits')).toEqual([]);
  expect((await readCapture('sentToModel')).filter(({ visitIds }) => visitIds?.includes(visit!.id))).toEqual([]);
  expect((await readCapture('jobs')).filter((job) => JSON.stringify(job).includes(visit!.id))).toEqual([]);
});
