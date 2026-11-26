import { join } from 'node:path';
import { expect } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

test.use({ companionInstalled: true, chatGptModels: ['gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'] });

test('Settings shows ChatGPT defaults and the Sent-to-model log records the models used', async ({
  context, openExtensionPage, fixtureUrl, readCapture,
}, info) => {
  const settings = await openExtensionPage('settings.html#model-providers');
  await settings.setViewportSize({ width: 820, height: 1000 });
  const callback = await signInToMockChatGpt(context, settings);
  await callback.close();
  const extraction = settings.getByRole('combobox', { name: 'Extraction model', exact: true });
  const notes = settings.getByRole('combobox', { name: 'Notes model', exact: true });
  await expect(extraction).toHaveText('Default: GPT-6-LUNA');
  await expect(notes).toHaveText('Default: GPT-6.1-TERRA');
  await expect(extraction).toHaveAccessibleDescription(/faster and use less/);
  await expect(notes).toHaveAccessibleDescription(/quality, speed, and cost/);
  await settings.locator('#model-providers').screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'chatgpt-defaults.png') : info.outputPath('chatgpt-defaults.png') });

  await extraction.click();
  await settings.getByRole('option', { name: 'GPT-6.2-SOL', exact: true }).click();
  await expect(extraction).toHaveText('GPT-6.2-SOL');
  await extraction.click();
  await settings.getByRole('option', { name: 'Default: GPT-6-LUNA', exact: true }).click();
  await expect(extraction).toHaveText('Default: GPT-6-LUNA');

  const panel = await openExtensionPage('sidepanel.html');
  const article = await context.newPage();
  await article.goto(fixtureUrl('learn.test', '/content/article.html'));
  await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.length > 0)).toBe(true);
  await article.locator('#highlight').selectText();
  await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === article.url())?.engagement).toBe('read');
  await expect.poll(async () => (await readCapture('pages'))[0]?.summary).toBe('Tombstones retain deletion history across replicas.');
  await panel.getByRole('button', { name: /^Wrap up expedition/ }).click();
  await expect.poll(async () => (await readCapture('expeditions'))[0]?.fieldNotes).toContain('A tombstone records');

  await settings.getByRole('tab', { name: 'Sent-to-model log' }).click();
  for (const [task, model] of [['Page notes', 'gpt-6-luna'], ['Field notes', 'gpt-6.1-terra']]) {
    const trigger = settings.getByRole('button', { name: new RegExp(`ChatGPT plan · ${task} · Succeeded`) });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const controls = await trigger.getAttribute('aria-controls');
    await expect(settings.locator(`[id="${controls}"]`).getByText(`Model: ${model}`, { exact: true })).toBeVisible();
  }
});
