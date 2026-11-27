import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import { expect, seedCapture, test } from './fixtures';

test('the header gear opens Settings and arrow keys and Tab navigate its sections', async ({ context, openExtensionPage }) => {
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 820 });
  const gear = panel.getByRole('banner').getByRole('link', { name: 'Settings', exact: true });
  await expect(gear).toBeVisible({ timeout: 5000 });
  await expect(panel.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(1);
  await expect(panel.getByRole('link', { name: 'Sent-to-model log', exact: true })).toHaveCount(0);
  const opened = context.waitForEvent('page');
  await gear.click();
  const settings = await opened;
  await settings.setViewportSize({ width: 360, height: 820 });
  const tabs = settings.getByRole('tablist', { name: 'Settings sections' });
  const privacy = tabs.getByRole('tab', { name: 'Privacy' });
  const companion = tabs.getByRole('tab', { name: 'Companion' });
  const log = tabs.getByRole('tab', { name: 'Sent-to-model log' });
  await expect(privacy).toHaveAttribute('aria-selected', 'true');
  await settings.getByRole('link', { name: 'Skip to content' }).focus();
  await settings.keyboard.press('Enter');
  await settings.keyboard.press('Tab');
  await expect(privacy).toBeFocused();
  await settings.keyboard.press('ArrowRight');
  await expect(companion).toBeFocused();
  await settings.keyboard.press('Enter');
  await expect(companion).toHaveAttribute('aria-selected', 'true');
  await expect(settings).toHaveURL(/#companion$/);
  await settings.keyboard.press('Tab');
  await expect(settings.getByRole('tabpanel', { name: 'Companion' })).toBeFocused();
  await settings.keyboard.press('Shift+Tab');
  await expect(companion).toBeFocused();
  for (const label of ['Model providers', 'Review', 'Obsidian sync', 'History import', 'Exports', 'Sent-to-model log', 'Diagnostics']) {
    await settings.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: label })).toBeFocused();
  }
  await settings.keyboard.press('ArrowLeft');
  await expect(log).toBeFocused();
  await settings.keyboard.press('Space');
  await expect(settings.getByRole('tabpanel', { name: 'Sent-to-model log' })).toBeVisible();
  await settings.reload();
  await expect(log).toHaveAttribute('aria-selected', 'true');
  await settings.goBack();
  await expect(companion).toHaveAttribute('aria-selected', 'true');
});

const url = 'https://www.google.com/search?q='.padEnd(300, 'replication');

// Use the browser's actual composited theme colors, including transparent ancestors.
async function contrast(locator: Locator, minimum: number, foreground: 'color' | 'stroke' = 'color') {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((element, foreground) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const paint = (color: string) => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); };
    const luminance = () => {
      const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const backgrounds: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      backgrounds.unshift(getComputedStyle(node).backgroundColor);
    }
    // Astryx paints the page with its body token, even when the ancestors are transparent.
    canvas.style.backgroundColor = 'var(--color-background-body)';
    document.body.append(canvas);
    paint(getComputedStyle(canvas).backgroundColor);
    for (const color of backgrounds) paint(color);
    const bg = luminance();
    const text = getComputedStyle(element)[foreground];
    paint(text);
    const fg = luminance();
    canvas.remove();
    return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
  }, foreground), { message: `${locator} WCAG AA contrast` }).toBeGreaterThanOrEqual(minimum);
}

async function textDoesNotOverlap(title: Locator, action?: Locator) {
  await expect(title).toBeVisible();
  const textBounds = await title.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(element);
    const ink = text.getBoundingClientRect();
    const clamped = getComputedStyle(element).webkitLineClamp === '2';
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      fits: clamped || ink.right <= box.right + 1, viewport: document.documentElement.clientWidth };
  });
  expect(textBounds.left).toBeGreaterThanOrEqual(0);
  expect(textBounds.right).toBeLessThanOrEqual(textBounds.viewport + 1);
  expect(textBounds.fits).toBe(true);
  if (!action) return;
  await expect(action).toBeVisible();
  const button = (await action.boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(textBounds.viewport + 1);
  expect(textBounds.right <= button.x + 1 || textBounds.bottom <= button.y + 1).toBe(true);
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [360, 1280]) {
    test(`a 300-character title stays inside its slot at ${width}px in ${colorScheme} mode`, async ({ openExtensionPage, readCapture }, info) => {
      const setup = await openExtensionPage('sidepanel.html');
      await readCapture('visits');
      const startedAt = Date.now();
      await seedCapture(setup, {
        expeditions: [{ id: 'long', title: url, startedAt, endedAt: null, rootVisitId: 'stop', centroid: null,
          drivingQuestion: null, kind: 'learning', threadId: null, userEdited: false, fieldNotes: null }],
        visits: [{ id: 'stop', title: url, url, canonicalUrl: url, startedAt, expeditionId: 'long', tabId: 1,
          parentVisitId: null, transition: 'typed', activeMs: 0, scrollDepth: 0, engagement: 'read' }],
        pages: [{ canonicalUrl: url, text: 'A fixture about tombstones.', textHash: 'fixture', summary: null,
          takeaways: [], embedding: null, pageKind: null, enrichedAt: null }],
      });
      async function open(path: string) {
        const page = await openExtensionPage(path);
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: 900 });
        return page;
      }
      const proof = (surface: string) => {
        const name = `${surface}-${width}-${colorScheme}.png`;
        return process.env.PROOF_DIR ? join(process.env.PROOF_DIR, name) : info.outputPath(name);
      };

      const expedition = await open('expedition.html?id=long&stop=stop');
      const stop = expedition.getByRole('region', { name: 'Trail stop details' });
      await textDoesNotOverlap(stop.getByRole('heading', { name: url }), stop.getByRole('button', { name: 'Close details' }));
      const node = expedition.getByRole('button', { name: url, exact: true });
      await expect(node).toHaveAttribute('title', url);
      await expedition.screenshot({ path: proof('expedition'), fullPage: true });

      const panel = await open('sidepanel.html');
      const star = panel.getByRole('button', { name: 'Star page', exact: true });
      await textDoesNotOverlap(panel.getByRole('treeitem').getByText(url, { exact: true }), star);
      await contrast(star.getByText('Star page'), 4.5);
      await contrast(panel.getByRole('link', { name: 'Open Journal' }).locator('svg path'), 3, 'stroke');
      await contrast(panel.getByRole('link', { name: 'Settings', exact: true }).locator('svg path'), 3, 'stroke');
      await panel.screenshot({ path: proof('side-panel'), fullPage: true });

      const journal = await open('journal.html');
      await textDoesNotOverlap(journal.getByRole('heading', { name: url }));
      await journal.screenshot({ path: proof('journal'), fullPage: true });
      await journal.getByRole('searchbox', { name: 'Search Journal' }).fill('tombstones');
      const result = journal.getByRole('link', { name: /^https:\/\/www\.google\.com/ });
      await expect(result).toHaveAttribute('href', url);
      const resultTitle = result.getByText(url, { exact: true });
      await textDoesNotOverlap(resultTitle);
      await journal.screenshot({ path: proof('search'), fullPage: true });
      if (width === 360) {
        await resultTitle.hover();
        await expect(journal.getByRole('tooltip')).toHaveText(url);
      }

      const settings = await open('settings.html#privacy');
      const privacy = settings.getByRole('tab', { name: 'Privacy' });
      await expect(privacy).toHaveAttribute('aria-selected', 'true');
      const visibleLabel = settings.locator(':not([aria-hidden="true"])');
      await contrast(privacy.getByText('Privacy').and(visibleLabel), 4.5);
      await contrast(settings.getByRole('tab', { name: 'Companion' }).getByText('Companion').and(visibleLabel), 4.5);
      await settings.getByLabel('Site to skip').fill('deny.test');
      await settings.getByRole('button', { name: 'Add site' }).click();
      await contrast(settings.getByRole('button', { name: 'Remove deny.test from skip list' }).getByText('Remove'), 4.5);
      await settings.screenshot({ path: proof('settings'), fullPage: true });
    });
  }
}
