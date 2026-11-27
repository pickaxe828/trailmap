import { join } from 'node:path';
import type { Concept, Expedition, Visit } from '../packages/shared/src/domain';
import type { ConceptEvidence } from '../packages/extension/src/concepts/evidence';
import { expect, seedCapture } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true });

const start = Date.UTC(2025, 4, 12, 12);
const GLYPHS = ['ˤ', 'ʕ', 'ʔ'] as const;

test('a symbol-only wrap-up title is retried, and the stored title names the symbol; search finds it by name and by symbol', async ({
  context, openExtensionPage, fixtureUrl, readCapture, mockOrigin,
}) => {
  const panel = await openExtensionPage('sidepanel.html');
  await signInToMockChatGpt(context, await openExtensionPage('settings.html#model-providers'));
  const article = await context.newPage();
  await article.goto(fixtureUrl('learn.test', '/content/symbol.html'));
  await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.includes('pharyngealization'))).toBe(true);
  await article.locator('#highlight').selectText();
  await expect.poll(async () => (await readCapture('visits'))[0]?.engagement).toBe('read');

  await panel.getByRole('button', { name: /^Wrap up expedition/ }).first().click();
  await expect.poll(async () => (await readCapture('expeditions'))[0]?.wrappedUpAt, { timeout: 60_000 }).toBeTruthy();
  const [expedition] = await readCapture('expeditions');
  expect(expedition!.title).toBe('ˤ: the pharyngealization mark in IPA');

  const calls = await (await fetch(mockOrigin + '/test/calls')).json() as { text?: { format: { name: string } }; instructions?: string }[];
  const wrapUps = calls.filter((call) => call.text?.format.name === 'expedition_wrap_up');
  expect(wrapUps).toHaveLength(2);
  expect(wrapUps[0]!.instructions).toContain('readable words');
  expect(wrapUps[1]!.instructions).toContain('no readable words');

  const journal = await openExtensionPage('journal.html');
  for (const query of ['pharyngealization', 'ˤ']) {
    await journal.getByRole('searchbox', { name: 'Search Journal' }).fill(query);
    await expect(journal.getByRole('link', { name: /pharyngealization mark in IPA/ }).first()).toBeVisible();
  }
});

test('IPA glyphs render, not tofu, in the Journal, the Expedition page, the Atlas and the side panel', async ({ openExtensionPage }, info) => {
  const proof = (name: string) => process.env.PROOF_DIR ? join(process.env.PROOF_DIR, name) : info.outputPath(name);
  const setup = await openExtensionPage('sidepanel.html');
  const expeditions: Expedition[] = [
    ['ˤ', 'ˤ: the pharyngealization mark in IPA'], ['ʕ', 'ʕ: the voiced pharyngeal fricative'], ['ʔ', 'ʔ: the glottal stop'],
  ].map(([glyph, title], i) => ({
    id: `ipa-${i}`, title: title!, startedAt: start + i * 3_600_000, endedAt: start + i * 3_600_000 + 1000, centroid: null,
    drivingQuestion: `What is ${glyph} in the IPA?`, kind: 'learning', threadId: null, userEdited: false, fieldNotes: null,
  }));
  // The side panel lists open Expeditions, so one stays open.
  expeditions.push({ ...expeditions[0]!, id: 'ipa-open', title: 'ʕ and ʔ: pharyngeal and glottal sounds', startedAt: Date.now(), endedAt: null, rootVisitId: 'vopen' });
  const visits: Visit[] = [...GLYPHS.map((glyph, i) => ({
    id: `v${i}`, title: `${glyph} in the IPA`, expeditionId: `ipa-${i}`, startedAt: start + i * 3_600_000,
    url: `https://learn.test/ipa-${i}`, canonicalUrl: `https://learn.test/ipa-${i}`, tabId: 1, parentVisitId: null,
    transition: 'link' as const, activeMs: 60_000, scrollDepth: 1, engagement: 'read' as const,
  })), {
    id: 'vopen', title: 'ʕ and ʔ in the IPA', expeditionId: 'ipa-open', startedAt: Date.now(), url: 'https://learn.test/ipa-open',
    canonicalUrl: 'https://learn.test/ipa-open', tabId: 1, parentVisitId: null, transition: 'link' as const, activeMs: 60_000, scrollDepth: 1, engagement: 'read' as const,
  }];
  const concepts: Concept[] = GLYPHS.map((glyph, i) => ({
    id: `c${i}`, name: `${glyph} (IPA)`, exposure: 1, firstSeen: start, aliases: [], gloss: `The IPA symbol ${glyph}.`, kind: 'concept', embedding: null,
  }));
  const conceptEvidence: ConceptEvidence[] = concepts.map((concept, i) => ({
    id: `e${i}`, conceptId: concept.id, visitId: visits[i]!.id, canonicalUrl: visits[i]!.canonicalUrl, startedAt: start, name: concept.name,
    gloss: concept.gloss, kind: 'concept', embedding: null, role: 'explains', salience: 'central',
  }));
  await seedCapture(setup, {
    expeditions, visits, concepts, conceptEvidence,
    pages: visits.map(({ canonicalUrl }) => ({ canonicalUrl, text: '', textHash: 'hash', summary: null, takeaways: [], embedding: null, pageKind: 'article', enrichedAt: null })),
  });

  const pages = [
    ['journal', await openExtensionPage('journal.html'), 'ˤ: the pharyngealization mark in IPA'],
    ['expedition', await openExtensionPage('expedition.html?id=ipa-0'), 'ˤ: the pharyngealization mark in IPA'],
    ['atlas', await openExtensionPage('atlas.html'), undefined],
    ['sidepanel', await openExtensionPage('sidepanel.html'), 'ʕ and ʔ: pharyngeal and glottal sounds'],
  ] as const;
  for (const [name, page, text] of pages) {
    await page.setViewportSize({ width: 1280, height: 900 });
    if (text) await expect(page.getByText(text).first()).toBeVisible();
    // The theme's system stack ends with fonts that cover IPA, ahead of the generic family.
    expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--font-family-body') || getComputedStyle(document.documentElement).getPropertyValue('--font-family-body'))).toContain('DejaVu Sans');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(500);
      await page.screenshot({ path: proof(`${name}-${scheme}.png`) });
    }
  }
});
