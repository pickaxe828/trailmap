import { join } from 'node:path';
import type { Page as BrowserPage } from '@playwright/test';
import type { Concept, Edge, Expedition, Page, Visit } from '../packages/shared/src/domain';
import type { ConceptEvidence } from '../packages/extension/src/concepts/evidence';
import { expect, seedCapture, test } from './fixtures';

const earlier = Date.UTC(2025, 4, 12, 12);
const later = Date.UTC(2025, 4, 19, 12);

async function seedAtlas(setup: BrowserPage, count: number, withThread = false) {
  const makeConcept = (id: string, name: string, exposure: number, firstSeen = later): Concept => ({
    id, name, exposure, firstSeen, aliases: id === 'tombstone' ? ['Deletion marker'] : [],
    gloss: id === 'tombstone' ? 'A marker that keeps a replicated delete from being undone.' : `About ${name}.`,
    kind: 'concept', embedding: null,
  });
  const concepts = [
    makeConcept('crdt', 'CRDT', 2, earlier),
    makeConcept('tombstone', 'Tombstone', 2),
    makeConcept('provisional', 'One-off mention', 1),
    makeConcept('errand', 'Desk lamp', 1, earlier),
    ...Array.from({ length: count - 2 }, (_, i) => makeConcept(`reference-${i}`, `Replication reference ${i}`, 1)),
  ] as const;
  const expeditions: Expedition[] = [
    { id: 'basics', title: 'Replication basics', kind: 'learning', startedAt: earlier, endedAt: earlier + 1000,
      centroid: null, drivingQuestion: null, threadId: null, userEdited: false, fieldNotes: null },
    { id: 'deletes', title: 'Replicated deletes', kind: 'learning', startedAt: later, endedAt: later + 1000,
      centroid: null, drivingQuestion: null, threadId: null, userEdited: false, fieldNotes: null },
    { id: 'shopping', title: 'Buy a lamp', kind: 'errand', startedAt: earlier, endedAt: earlier + 1000,
      centroid: null, drivingQuestion: null, threadId: null, userEdited: false, fieldNotes: null },
  ];
  const makeVisit = (id: string, title: string, expeditionId: string, startedAt: number): Visit => ({
    id, title, expeditionId, startedAt, url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`,
    tabId: 1, parentVisitId: null, transition: 'link', activeMs: 60_000, scrollDepth: 1, engagement: 'read',
  });
  const visits = [makeVisit('primer', 'Replication primer', 'basics', earlier),
    makeVisit('paper', 'CRDT paper', 'deletes', later), makeVisit('reference', 'Delete reference', 'deletes', later),
    makeVisit('lamp', 'Lamp description', 'shopping', earlier)] as const;
  const pages: Page[] = visits.map(({ canonicalUrl }) => ({ canonicalUrl, text: '', textHash: 'hash', summary: null,
    takeaways: [], embedding: null, pageKind: 'article', enrichedAt: null }));
  const evidence = (concept: Concept, visit: Visit, name = concept.name): ConceptEvidence => ({
    id: `${concept.id}:${visit.id}`, conceptId: concept.id, visitId: visit.id, canonicalUrl: visit.canonicalUrl,
    startedAt: visit.startedAt, name, gloss: concept.gloss, kind: concept.kind, embedding: null,
    role: concept.id === 'provisional' ? 'mentions' : 'explains', salience: concept.id === 'provisional' ? 'passing' : 'supporting',
  });
  const conceptEvidence = [evidence(concepts[0], visits[0]), evidence(concepts[0], visits[1]),
    evidence(concepts[1], visits[1]), evidence(concepts[1], visits[2], 'Deletion marker'), evidence(concepts[2], visits[0]),
    evidence(concepts[3], visits[3]), ...concepts.slice(4).map((concept) => evidence(concept, visits[2]))];
  const edges: Edge[] = [{ id: 'part', from: 'tombstone', to: 'crdt', type: 'part_of', weight: 1, evidence: ['paper'] }];
  for (let i = 0; i < count - 3; i += 1) {
    if (i % 10 !== 9) edges.push({ id: `edge-${i}`, from: `reference-${i}`, to: `reference-${i + 1}`,
      type: 'related_to', weight: 1, evidence: ['reference'] });
  }
  const threadId = 'replication-basics';
  if (withThread) {
    expeditions[0]!.threadId = threadId;
    expeditions.push({ ...expeditions[0]!, id: 'review', title: 'Review replica types', startedAt: earlier + 2000,
      endedAt: earlier + 3000 });
  }
  await seedCapture(setup, { concepts: [...concepts], expeditions, visits: [...visits], pages, conceptEvidence, edges,
    threads: withThread ? [{ id: threadId, title: 'Replication foundations', status: 'dormant', question: null,
      lastActiveAt: earlier + 3000, livingNote: null, centroid: null, conceptIds: ['tombstone'] }] : [] });
}

test('the Atlas focuses a Concept through search and shows its Pages, Expeditions and neighbours', async ({ context, openExtensionPage }, info) => {
  const panel = await openExtensionPage('sidepanel.html');
  await seedAtlas(panel, 24);
  const [atlas] = await Promise.all([context.waitForEvent('page'), panel.getByRole('link', { name: 'Open Atlas' }).click()]);
  await atlas.emulateMedia({ colorScheme: 'light' });
  await expect(atlas.getByRole('heading', { name: 'Atlas', exact: true })).toBeVisible();
  await expect(atlas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect(atlas.getByText('24 of 24 concepts on the map')).toBeVisible();

  const search = atlas.getByRole('combobox', { name: 'Find a concept' });
  for (const hidden of ['One-off mention', 'Desk lamp']) {
    await search.fill(hidden);
    await expect(atlas.getByRole('option', { name: 'No matching concepts' })).toBeVisible();
  }
  await search.fill('deletion marker');
  await atlas.getByRole('option', { name: /Tombstone/ }).click();
  const card = atlas.getByRole('complementary', { name: 'Concept details' });
  await expect(card.getByRole('heading', { name: 'Tombstone' })).toBeVisible();
  await expect(card.getByText('A marker that keeps a replicated delete from being undone.')).toBeVisible();
  await expect(card.getByRole('link', { name: 'CRDT paper' })).toHaveAttribute('href', 'https://learn.test/paper');
  await expect(card.getByRole('link', { name: 'Delete reference' })).toHaveAttribute('href', 'https://learn.test/reference');
  await expect(card.getByRole('link', { name: 'Replicated deletes' })).toHaveAttribute('href', /expedition.html\?id=deletes$/);
  await expect(card.getByRole('link', { name: 'Replication basics' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'CRDT', exact: true })).toBeVisible();

  const labels = atlas.locator('canvas.sigma-labels');
  const ink = () => labels.evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let rgb = '';
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) { rgb = `${data[i - 3]},${data[i - 2]},${data[i - 1]}`; break; }
    return rgb;
  });
  await expect.poll(ink).not.toBe('');
  const lightInk = await ink();
  await atlas.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'atlas-light.png') : info.outputPath('atlas-light.png') });
  await atlas.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => !!(await ink()) && (await ink()) !== lightInk).toBe(true);
  await atlas.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'atlas-dark.png') : info.outputPath('atlas-dark.png') });

  await atlas.getByRole('slider', { name: 'Replay by date' }).press('Home');
  await expect(atlas.getByText('1 of 24 concepts on the map')).toBeVisible();
  await expect(card).toHaveCount(0);
  await atlas.getByRole('slider', { name: 'Replay by date' }).press('End');
  await expect(atlas.getByText('24 of 24 concepts on the map')).toBeVisible();
  await search.fill('CRDT');
  await atlas.getByRole('option', { name: 'CRDT', exact: true }).click();
  await expect(card.getByRole('link', { name: 'Replication basics' })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Replicated deletes' })).toBeVisible();
});

test('the Atlas Thread filter shows only Concepts with evidence in its sessions', async ({ openExtensionPage }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seedAtlas(setup, 24, true);
  const atlas = await openExtensionPage('atlas.html');
  const thread = atlas.getByRole('combobox', { name: 'Filter by thread' });
  const search = atlas.getByRole('combobox', { name: 'Find a concept' });
  await search.fill('Tombstone');
  await atlas.getByRole('option', { name: 'Tombstone' }).click();
  await expect(atlas.getByRole('heading', { name: 'Tombstone' })).toBeVisible();
  await thread.click();
  await atlas.getByRole('option', { name: 'Replication foundations' }).click();
  await expect(atlas.getByText('1 of 24 concepts on the map')).toBeVisible();
  await expect(atlas.getByRole('heading', { name: 'Tombstone' })).toHaveCount(0);
  await search.fill('Tombstone');
  await expect(atlas.getByRole('option', { name: 'No matching concepts' })).toBeVisible();
  await search.fill('CRDT');
  await atlas.getByRole('option', { name: 'CRDT', exact: true }).click();
  await expect(atlas.getByRole('link', { name: 'Replication primer' })).toBeVisible();
  await atlas.screenshot({ path: process.env.PROOF_DIR ? join(process.env.PROOF_DIR, 'atlas-thread.png') : info.outputPath('atlas-thread.png') });
  await thread.click();
  await atlas.getByRole('option', { name: 'All threads' }).click();
  await expect(atlas.getByText('24 of 24 concepts on the map')).toBeVisible();
});

test('the Atlas caps the default map and can focus lower-ranked Concepts in a 2,000-Concept collection', async ({ openExtensionPage }) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seedAtlas(setup, 2000);
  const atlas = await openExtensionPage('atlas.html');
  await expect(atlas.locator('canvas.sigma-nodes')).toBeVisible();
  await expect(atlas.getByText('80 of 2,000 concepts on the map')).toBeVisible();
  const search = atlas.getByRole('combobox', { name: 'Find a concept' });
  await search.fill('Replication reference 1997');
  await atlas.getByRole('option', { name: 'Replication reference 1997' }).click();
  await expect(atlas.getByRole('heading', { name: 'Replication reference 1997' })).toBeVisible();
  await expect(atlas.getByText('81 of 2,000 concepts on the map')).toBeVisible();
});

async function seedGlimpsed(setup: BrowserPage) {
  const learning = { kind: 'learning' as const, centroid: null, drivingQuestion: null, threadId: null, userEdited: false, fieldNotes: null };
  const expedition: Expedition = { id: 'phonetics', title: 'Vowel phonation', startedAt: earlier, endedAt: earlier + 1000, ...learning };
  const makeVisit = (id: string, engagement: Visit['engagement'], activeMs: number, scrollDepth: number): Visit => ({
    id, title: id, expeditionId: 'phonetics', startedAt: earlier, url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`,
    tabId: 1, parentVisitId: null, transition: 'link', activeMs, scrollDepth, engagement });
  const visits = [makeVisit('skim-one', 'skimmed', 20_000, 0.2), makeVisit('skim-two', 'skimmed', 15_000, 0.5), makeVisit('read-it', 'read', 90_000, 0.9)];
  const concept = (id: string, name: string): Concept => ({ id, name, aliases: [], kind: 'concept', gloss: `About ${name}.`, embedding: null, exposure: 2, firstSeen: earlier });
  const evidence = (id: string, concept: Concept, visit: Visit, role: ConceptEvidence['role'], salience: ConceptEvidence['salience']): ConceptEvidence => ({
    id, conceptId: concept.id, visitId: visit.id, canonicalUrl: visit.canonicalUrl, startedAt: earlier, name: concept.name, gloss: concept.gloss,
    kind: 'concept', embedding: null, role, salience });
  const taa = concept('taa', 'Taa');
  const pharyngealization = concept('pharyngealization', 'Pharyngealization');
  await seedCapture(setup, {
    concepts: [taa, pharyngealization], expeditions: [expedition], visits,
    pages: visits.map(({ canonicalUrl }) => ({ canonicalUrl, text: '', textHash: 'hash', summary: null, takeaways: [], embedding: null, pageKind: 'article', enrichedAt: null })),
    conceptEvidence: [evidence('t1', taa, visits[0]!, 'mentions', 'passing'), evidence('t2', taa, visits[1]!, 'mentions', 'passing'),
      evidence('p1', pharyngealization, visits[2]!, 'explains', 'central')],
  });
}

test('the Atlas shows what I learned, offers what I only saw, and lets me say I did not learn something', async ({ openExtensionPage }, info) => {
  const proof = (name: string) => process.env.PROOF_DIR ? join(process.env.PROOF_DIR, name) : info.outputPath(name);
  const setup = await openExtensionPage('sidepanel.html');
  await seedGlimpsed(setup);
  const atlas = await openExtensionPage('atlas.html');
  await atlas.setViewportSize({ width: 1280, height: 900 });
  for (const scheme of ['light', 'dark'] as const) {
    await atlas.emulateMedia({ colorScheme: scheme });
    await expect(atlas.getByText('1 of 1 concepts on the map')).toBeVisible();
    await atlas.screenshot({ path: proof(`atlas-default-${scheme}.png`) });
  }
  const search = atlas.getByRole('combobox', { name: 'Find a concept' });
  await search.fill('Taa');
  await expect(atlas.getByRole('option', { name: 'No matching concepts' })).toBeVisible();

  // Two skimmed passing mentions appear only when asked for, faded.
  await atlas.getByRole('switch', { name: 'Include concepts I only saw' }).check();
  await expect(atlas.getByText('2 of 2 concepts on the map')).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await atlas.emulateMedia({ colorScheme: scheme });
    // Few concepts, so every one is labelled: Pharyngealization and Taa both have label pixels drawn.
    await expect.poll(() => atlas.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.sigma-labels')!;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const half = canvas.height / 2;
      const inked = (from: number, to: number) => { for (let y = from; y < to; y++) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3]! > 0) return true; return false; };
      return inked(0, half) && inked(half, canvas.height);
    })).toBe(true);
    await atlas.screenshot({ path: proof(`atlas-include-seen-${scheme}.png`) });
    await atlas.locator('canvas.sigma-labels').screenshot({ path: proof(`atlas-map-labels-${scheme}.png`) });
  }
  await search.fill('');
  await search.fill('Taa');
  await atlas.getByRole('option', { name: 'Taa', exact: true }).click();
  await expect(atlas.getByText('Only seen on pages.')).toBeVisible();

  // "I didn't learn this" hides the concept, Undo brings it back.
  await search.fill('Pharyngealization');
  await atlas.getByRole('option', { name: 'Pharyngealization', exact: true }).click();
  await expect(atlas.getByText('Studied: it is a main topic of a page you read.')).toBeVisible();
  await atlas.getByRole('button', { name: 'I didn’t learn this' }).click();
  await expect(atlas.getByText('Hidden: you said you didn’t learn this.')).toBeVisible();
  await expect(atlas.getByText('1 of 1 concepts on the map')).toBeVisible();
  await atlas.screenshot({ path: proof('atlas-hidden-card.png') });
  await atlas.getByRole('button', { name: 'Undo: show on the Atlas' }).click();
  await expect(atlas.getByText('2 of 2 concepts on the map')).toBeVisible();

  // Settings lists the hidden concept and restores it too.
  await atlas.getByRole('button', { name: 'I didn’t learn this' }).click();
  const settings = await openExtensionPage('settings.html#privacy');
  await settings.setViewportSize({ width: 1280, height: 900 });
  await expect(settings.getByRole('heading', { name: 'Concepts hidden from the Atlas' })).toBeVisible();
  await settings.screenshot({ path: proof('settings-hidden-concepts.png'), fullPage: true });
  await settings.getByRole('button', { name: 'Show Pharyngealization on the Atlas' }).click();
  await expect(settings.getByText('No hidden concepts.')).toBeVisible();
});
