import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test as base } from './fixtures';

const fakeKey = 'fixture-only-anthropic-key';
const mockSummary = 'The selected model summarizes how replicated lists record deletions.';
const mockNotes = 'The local model found that tombstones preserve deletion history.';

async function readJson(req: import('node:http').IncomingMessage) {
  let raw = '';
  for await (const part of req) raw += part;
  return JSON.parse(raw);
}
const test = base.extend<{ localApi: string }>({
  localApi: async ({}, use) => {
    const server = createServer(async (req, res) => {
      const answer = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/api/tags') return answer(200, { models: [{ name: 'gemma:latest' }, { name: 'gemma:notes' }] });
      if (req.method === 'POST' && req.url === '/api/chat') {
        const body = await readJson(req);
        if (body.model !== 'gemma:notes') return answer(404, {});
        const properties = body.format?.properties;
        const output = properties?.merge_with ? {
          title: 'Deleting replicated items', driving_question: 'How do replicas delete items?', kind: 'learning', merge_with: [],
        } : properties?.key_ideas ? {
          found: mockNotes, key_ideas: [{ idea: 'Tombstones remember deletes.', page: 'p1' }],
          trail: 'The Page describes replicated lists.', loose_ends: [],
        } : undefined;
        if (!output) return answer(400, {});
        return answer(200, { done: true, done_reason: 'stop', message: { content: JSON.stringify(output) } });
      }
      if (req.headers['x-api-key'] !== fakeKey) return answer(401, { error: { message: 'No fixture key' } });
      if (req.method === 'GET' && req.url === '/anthropic/v1/models') return answer(200, { has_more: false, data: [
        { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }, { id: 'fixture-claude', display_name: 'Fixture Claude' },
      ] });
      if (req.method === 'POST' && req.url === '/anthropic/v1/messages') {
        const body = await readJson(req);
        const properties = body.output_config?.format?.schema?.properties;
        if (body.model === 'fixture-claude' && properties?.summary) {
          const output = {
            summary: mockSummary, takeaways: ['Deletions leave evidence.', 'Replicas can converge.'],
            ...(properties.page_kind ? { answers_question: 'How do replicas delete items?', page_kind: 'article', concepts: [], relations: [] } : {}),
          };
          return answer(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }] });
        }
      }
      answer(400, {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try { await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  },
  companionEnv: async ({ companionEnv, localApi }, use) => {
    await use({ ...companionEnv, TRAILMAP_OPENAI_BASE_URL: `${localApi}/openai/v1`,
      TRAILMAP_OPENAI_AUTH_BASE_URL: localApi, TRAILMAP_ANTHROPIC_BASE_URL: `${localApi}/anthropic/v1`, TRAILMAP_OLLAMA_BASE_URL: localApi });
  },
});

test.use({ companionInstalled: true });

test('saves the key and uses independent model choices from Settings', async ({
  context, openExtensionPage, fixtureUrl, readCapture, companionDataDir,
}, info) => {
  const settings = await openExtensionPage('onboarding.html#model-providers');
  await settings.setViewportSize({ width: 820, height: 1000 });
  const key = settings.getByLabel('Anthropic API key');
  await expect(settings.getByText('Anthropic: No key saved')).toBeVisible();
  await key.fill(fakeKey);
  await settings.getByRole('button', { name: 'Save API key' }).click();
  await expect(key).toHaveValue('');
  await expect(settings.getByText('Anthropic: Connected · key saved')).toBeVisible();
  const choose = async (field: string, option: string) => {
    await settings.getByRole('combobox', { name: field, exact: true }).click();
    await settings.getByRole('option', { name: option, exact: true }).click();
  };
  await choose('Extraction provider', 'Anthropic');
  await choose('Extraction model', 'Fixture Claude');
  await choose('Notes provider', 'Ollama');
  await choose('Notes model', 'gemma:notes');
  await settings.reload();
  await expect(settings.getByRole('combobox', { name: 'Extraction model', exact: true })).toHaveText('Fixture Claude');
  await expect(settings.getByRole('combobox', { name: 'Notes model', exact: true })).toHaveText('gemma:notes');
  await expect(key).toHaveValue('');
  expect(await settings.evaluate(async () => JSON.stringify(await chrome.storage.local.get()))).not.toContain(fakeKey);
  expect(await readFile(join(companionDataDir, 'companion.log'), 'utf8')).not.toContain(fakeKey);

  await settings.locator('#model-providers').screenshot({ path: process.env.PROOF_DIR
    ? join(process.env.PROOF_DIR, 'model-providers.png') : info.outputPath('model-providers.png') });

  const panel = await openExtensionPage('sidepanel.html');
  const article = await context.newPage();
  await article.goto(fixtureUrl('learn.test', '/content/article.html'));
  await article.bringToFront();
  await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.includes('Tombstones preserve causal history'))).toBe(true);
  await article.locator('#short-copy').selectText();
  await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === article.url())?.engagement).toBe('read');
  await panel.getByRole('button', { name: 'Summarize this page' }).evaluate((button) => (button as HTMLButtonElement).click());
  await expect(panel.getByRole('heading', { name: 'Summary: Deleting items in a replicated list' })).toBeVisible();
  await expect(panel.getByText('Sends this page’s captured text to your extraction provider.')).toBeVisible();
  await expect.poll(async () => (await readCapture('pages')).some(({ summary }) => summary === mockSummary)).toBe(true);

  await panel.getByRole('button', { name: /^Wrap up expedition/ }).click();
  await expect.poll(async () => (await readCapture('expeditions'))[0]?.fieldNotes).toContain(mockNotes);
  for (const [entry, model] of [[/Anthropic · page summary/, 'fixture-claude'], [/Ollama · field notes/, 'gemma:notes']] as const) {
    const trigger = settings.getByRole('button', { name: entry });
    await trigger.click();
    const controls = await trigger.getAttribute('aria-controls');
    await expect(settings.locator(`[id="${controls}"]`).getByText(`Model: ${model}`, { exact: true })).toBeVisible();
  }
});
