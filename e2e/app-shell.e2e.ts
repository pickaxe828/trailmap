import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, seedCapture, test } from './fixtures';

const surfaces = [
  ['journal', 'journal.html', 'Journal', 'Journal'],
  ['trail', 'trail.html', 'Trail', 'Trail'],
  ['atlas', 'atlas.html?concept=tombstone', 'Atlas', 'Atlas'],
  ['expedition', 'expedition.html?id=deletes', 'Replicated deletes', 'Journal'],
  ['thread', 'thread.html?id=replication', 'Replication research', 'Journal'],
  ['settings', 'settings.html', 'Settings', 'Settings'],
  ['onboarding', 'onboarding.html', 'Welcome to Trailmap', null],
] as const;

async function seedResearch(page: Page) {
  const now = Date.now();
  const today = new Date(now).setHours(0, 0, 0, 0);
  const studies = [
    { id: 'basics', title: 'Replication basics', drivingQuestion: 'How do replicas converge?', startedAt: now - 86_400_000 },
    { id: 'deletes', title: 'Replicated deletes', drivingQuestion: 'How can replicas agree on a delete?', startedAt: Math.max(today, now - 600_000) },
  ];
  const visits = studies.map(({ id, title, startedAt }) => ({ id: `${id}-visit`, title, startedAt, expeditionId: id,
    url: `https://learn.test/${id}`, canonicalUrl: `https://learn.test/${id}`, tabId: 1, parentVisitId: null,
    transition: 'typed' as const, activeMs: 120_000, scrollDepth: 1, engagement: 'read' as const }));
  const notes = '## Found\n\nA tombstone records a deletion so it can be replicated without restoring the deleted item.';
  const concepts = [
    { id: 'crdt', name: 'CRDT', gloss: 'A data type that lets independently updated replicas converge.' },
    { id: 'tombstone', name: 'Tombstone', gloss: 'A record of a deletion in a replicated data structure.' },
  ];
  await seedCapture(page, {
    visits,
    expeditions: studies.map((study) => ({ ...study, rootVisitId: `${study.id}-visit`, endedAt: Math.min(study.startedAt + 120_000, now),
      kind: 'learning', threadId: 'replication', fieldNotes: notes, userEdited: true })),
    threads: [{ id: 'replication', title: 'Replication research', question: 'How do replicas stay consistent?', status: 'active',
      lastActiveAt: Math.max(today, now - 480_000), livingNote: notes, centroid: null, conceptIds: concepts.map(({ id }) => id) }],
    concepts: concepts.map((concept) => ({ ...concept, aliases: [], kind: 'concept', embedding: null, firstSeen: visits[0]!.startedAt, exposure: 2 })),
    conceptEvidence: concepts.flatMap((concept) => visits.map((visit) => ({ ...concept, id: `${concept.id}:${visit.id}`,
      conceptId: concept.id, visitId: visit.id, canonicalUrl: visit.canonicalUrl, startedAt: visit.startedAt,
      kind: 'concept', role: 'explains', embedding: null }))),
    pages: visits.map(({ canonicalUrl }) => ({ canonicalUrl, text: '', textHash: 'fixture', summary: null, takeaways: [],
      embedding: null, pageKind: 'article', enrichedAt: null })),
    edges: [{ id: 'part', from: 'tombstone', to: 'crdt', type: 'part_of', weight: 2, evidence: visits.map(({ id }) => id) }],
  });
}

test('full-tab pages share the same navigation and computed background in both themes', async ({ openExtensionPage }, info) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seedResearch(setup);
  await setup.reload();
  const backgrounds: string[] = [];
  for (const colorScheme of ['light', 'dark'] as const) {
    let expectedBackground: string | undefined;
    for (const [name, path, title, current] of surfaces) {
      const page = await openExtensionPage(path);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      const main = page.getByRole('main');
      const background = await main.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(background, `${name} paints its page background in ${colorScheme}`).not.toBe('rgba(0, 0, 0, 0)');
      expectedBackground ??= background;
      expect(background, `${name} matches the Journal in ${colorScheme}`).toBe(expectedBackground);
      const nav = page.getByRole('navigation', { name: 'Trailmap navigation' });
      await expect(nav.getByRole('link', { name: 'Trailmap', exact: true })).toHaveAttribute('href', /\/journal\.html$/);
      for (const destination of ['Journal', 'Trail', 'Atlas', 'Settings']) {
        const link = nav.getByRole('link', { name: destination, exact: true });
        await expect(link).toHaveAttribute('href', new RegExp(`/${destination.toLowerCase()}\\.html$`));
        if (destination === current) await expect(link).toHaveAttribute('aria-current', destination === 'Journal' && name !== 'journal' ? 'location' : 'page');
        else await expect(link).not.toHaveAttribute('aria-current', /page|location/);
      }
      if (name === 'expedition' || name === 'thread') {
        const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
        await expect(breadcrumb.getByRole('link', { name: 'Journal' })).toHaveAttribute('href', /\/journal\.html$/);
        await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(title);
      }
      if (name === 'atlas') {
        await expect(page.locator('canvas.sigma-nodes')).toBeVisible();
        await expect(main.getByRole('heading', { name: 'Tombstone', exact: true })).toBeVisible();
      }
      if (name === 'expedition' || name === 'trail') await expect(main.locator('.react-flow__node').first()).toBeVisible();
      if (name === 'journal') await expect(main.getByRole('heading', { name: 'Replication research' })).toBeVisible();
      if (name === 'thread') await expect(main.locator('.react-flow__node')).toHaveCount(2);
      if (name === 'expedition' || name === 'thread') {
        const notes = main.getByRole('region', { name: name === 'expedition' ? 'Field notes' : 'Living note' });
        const surface = await notes.evaluate((element) => {
          for (let node: Element | null = element; node; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;
            if (color !== 'rgba(0, 0, 0, 0)') return color;
          }
        });
        expect(surface, `${name} notes are raised from the ${colorScheme} page background`).not.toBe(background);
      }
      if (process.env.PROOF_DIR) await page.screenshot({ path: join(process.env.PROOF_DIR, `${name}-${colorScheme}.png`) });
      await page.close();
    }
    backgrounds.push(expectedBackground!);
    await setup.setViewportSize({ width: 1280, height: 900 });
    await setup.emulateMedia({ colorScheme });
    if (process.env.PROOF_DIR) await setup.screenshot({ path: join(process.env.PROOF_DIR, `sidepanel-${colorScheme}.png`) });
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
  await info.attach('computed-page-backgrounds', { body: JSON.stringify({ light: backgrounds[0], dark: backgrounds[1] }), contentType: 'application/json' });
});

test('Search and Settings work in every top bar; the shortcuts focus Journal search without stealing typed slashes', async ({ openExtensionPage }) => {
  for (const [, path] of surfaces) {
    const page = await openExtensionPage(path);
    const nav = page.getByRole('navigation', { name: 'Trailmap navigation' });
    await nav.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/journal\.html(?:\?|$)/);
    await expect(page.getByRole('searchbox', { name: 'Search Journal' })).toBeFocused();
    if (!path.startsWith('journal')) await page.goBack();
    await nav.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\.html$/);
    await expect(page.getByRole('tab', { name: 'Privacy' })).toBeVisible();
    await page.close();
  }

  const page = await openExtensionPage('atlas.html');
  const nav = page.getByRole('navigation', { name: 'Trailmap navigation' });
  await page.setViewportSize({ width: 360, height: 820 });
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  for (const name of ['Trailmap', 'Journal', 'Trail', 'Atlas', 'Search', 'Settings']) {
    const control = nav.getByRole(name === 'Search' ? 'button' : 'link', { name, exact: true });
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search Journal' });
  await expect(search).toBeFocused();
  await search.pressSequentially('trail/atlas');
  await expect(search).toHaveValue('trail/atlas');
  await nav.getByRole('link', { name: 'Trail', exact: true }).focus();
  await page.keyboard.press('Meta+k');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('trail/atlas');
});

test('the top bar stays pinned when content scrolls and one attention banner sits below it', async ({ openExtensionPage }) => {
  const setup = await openExtensionPage('sidepanel.html');
  await seedResearch(setup);
  await seedCapture(setup, { modelHealth: [{ id: 'jobs', code: 'usage_unavailable', recent: [1, 2, 3],
    attention: { code: 'usage_unavailable', provider: 'chatgpt' } }] });
  for (const [, path, title] of surfaces) {
    const page = await openExtensionPage(path);
    const nav = page.getByRole('navigation', { name: 'Trailmap navigation' });
    const banner = page.getByRole('status').filter({ hasText: 'AI notes are failing' });
    await expect(banner).toHaveCount(1);
    await expect(banner.getByRole('link', { name: 'Details in Diagnostics' })).toHaveAttribute('href', '/settings.html#diagnostics');
    const heading = page.getByRole('heading', { level: 1, name: title, exact: true });
    expect((await banner.boundingBox())!.y).toBeGreaterThanOrEqual((await nav.boundingBox())!.height);
    expect((await heading.boundingBox())!.y).toBeGreaterThan((await banner.boundingBox())!.y);

    // Force overflow even on pages whose controls and content fit in the viewport.
    const main = page.getByRole('main');
    await main.evaluate((element) => {
      const extra = document.createElement('section');
      extra.style.minHeight = '150vh';
      element.append(extra);
    });
    const position = (await nav.boundingBox())!.y;
    await heading.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(async () => (await heading.boundingBox())!.y).toBeLessThan(0);
    expect((await nav.boundingBox())!.y).toBe(position);
    await page.close();
  }
});

test('the compact side panel opens the full-tab destinations without replacing the panel', async ({ context, openExtensionPage }) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 320, height: 820 });
  const nav = panel.getByRole('banner').getByRole('navigation', { name: 'Trailmap navigation' });
  for (const [label, path] of [['Trailmap', 'journal'], ['Open Journal', 'journal'], ['Open Trail', 'trail'], ['Open Atlas', 'atlas'], ['Settings', 'settings']]) {
    const link = nav.getByRole('link', { name: label, exact: true });
    if (label !== 'Trailmap') await expect(link.locator('svg')).toBeVisible();
    const [destination] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await expect(destination).toHaveURL(new RegExp(`/${path}\\.html$`));
    await destination.close();
    await expect(panel).toHaveURL(/\/sidepanel\.html$/);
  }
});
