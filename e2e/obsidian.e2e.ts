import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test as base } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

base('Obsidian sync waits for the companion, but both settings exports download', async ({ openExtensionPage }, info) => {
  const settings = await openExtensionPage('settings.html#obsidian');
  await expect(settings.getByText('Obsidian sync is waiting for the companion.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Save vault folder' })).toBeDisabled();
  await settings.screenshot({ path: join(process.env.PROOF_DIR ?? info.outputDir, 'sync-waiting.png') });

  for (const [label, filename] of [
    ['Export all as Markdown (zip)', 'trailmap-markdown.zip'], ['Export JSON dump', 'trailmap.json'],
  ] as const) {
    const started = settings.waitForEvent('download');
    await settings.getByRole('button', { name: label }).click();
    const download = await started;
    expect(download.suggestedFilename()).toBe(filename);
    const data = await readFile((await download.path())!);
    if (filename.endsWith('.zip')) expect(data.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    else expect(JSON.parse(data.toString()).tables).toMatchObject({ expeditions: [], concepts: [], visits: [] });
  }
});

test.describe('with the installed companion and a mock model', () => {
  test.use({ companionInstalled: true });

  test('wrapping up and editing an Expedition syncs the same note with a link to a visible Concept', async ({
    context, openExtensionPage, fixtureUrl, readCapture, companionDataDir,
  }, info) => {
    const vault = join(companionDataDir, 'test-vault');
    await mkdir(vault);
    const settings = await openExtensionPage('settings.html#obsidian');
    const folder = settings.getByRole('textbox', { name: 'Obsidian vault folder path' });
    await expect(folder).toBeEnabled();
    await folder.fill(join(vault, 'missing'));
    await settings.getByRole('button', { name: 'Save vault folder' }).click();
    await expect(settings.getByText('Enter the full path to an existing, writable folder.')).toBeVisible();
    await folder.fill(vault);
    await settings.getByRole('button', { name: 'Save vault folder' }).click();
    await expect(settings.getByText('Obsidian sync is up to date.')).toBeVisible();

    const panel = await openExtensionPage('sidepanel.html');
    await signInToMockChatGpt(context, settings);
    const article = await context.newPage();
    await article.goto(fixtureUrl('learn.test', '/content/article.html'));
    await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.length > 0)).toBe(true);
    await article.locator('#highlight').selectText();
    await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === article.url())?.engagement).toBe('read');
    await panel.getByRole('button', { name: /^Wrap up expedition/ }).first().click();

    const findNote = async (kind: string) => (await readdir(vault)).find((name) => name.startsWith(`trailmap-${kind}-`) && name.endsWith('.md'));
    const readNote = async (kind: string) => {
      const filename = await findNote(kind);
      return filename ? readFile(join(vault, filename), 'utf8') : '';
    };
    await expect.poll(() => readNote('expedition'), { timeout: 45_000 }).toContain('## Key ideas');
    await expect.poll(() => readNote('concept'), { timeout: 45_000 }).toContain('# Tombstone');
    const conceptPath = (await findNote('concept'))!;
    await expect.poll(() => readNote('expedition')).toContain(`[[${conceptPath.slice(0, -3)}|Tombstone]]`);
    expect(await readNote('expedition')).toContain('title: "How replicated lists delete items"');
    expect(await readNote('expedition')).toContain(`sourceUrls: ["${fixtureUrl('learn.test', '/replicated-lists?chapter=2')}"]`);

    const [expedition] = await readCapture('expeditions');
    const originalPath = (await findNote('expedition'))!;
    const expeditionPage = await openExtensionPage(`expedition.html?id=${encodeURIComponent(expedition!.id)}`);
    await expeditionPage.getByRole('button', { name: 'Edit field notes' }).click();
    await expeditionPage.getByRole('textbox', { name: 'Field notes Markdown' }).fill('## Manual edit\n\nKeep this observation.');
    await expeditionPage.getByRole('button', { name: 'Save field notes' }).click();
    await expect.poll(() => readFile(join(vault, originalPath), 'utf8')).toContain('Keep this observation.');

    const zipStarted = settings.waitForEvent('download');
    await settings.getByRole('button', { name: 'Export all as Markdown (zip)' }).click();
    const zip = await zipStarted;
    expect(execFileSync('unzip', ['-p', (await zip.path())!, originalPath], { encoding: 'utf8' })).toBe(await readNote('expedition'));
    expect(execFileSync('unzip', ['-p', (await zip.path())!, conceptPath], { encoding: 'utf8' })).toBe(await readNote('concept'));
    await expect(settings.getByText('Obsidian sync is up to date.')).toBeVisible();
    await settings.screenshot({ path: join(process.env.PROOF_DIR ?? info.outputDir, 'sync-settings.png') });

    // Forgot the only evidence for both notes. The reconciler prunes its copies, not unrelated files.
    const unrelated = join(vault, 'Personal.md');
    await writeFile(unrelated, '# Personal note');
    await panel.getByRole('tree').getByRole('button', { name: /^Actions for/ }).click();
    await panel.getByRole('menuitem', { name: 'Forget page' }).click();
    await panel.getByRole('alertdialog').getByRole('button', { name: 'Forget page' }).click();
    await expect.poll(() => readdir(vault)).toEqual(['Personal.md']);
    expect(await readFile(unrelated, 'utf8')).toBe('# Personal note');
  });
});
