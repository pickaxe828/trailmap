import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, seedCapture } from './fixtures';
import { signInToMockChatGpt, test } from './model-fixtures';

const warning = 'AI notes are failing';

test.describe('failing wrap-up', () => {
  test.use({ companionInstalled: true });

  test('three failures reach Settings, the side panel and Journal; Retry now restores field notes', async ({
    context, openExtensionPage, fixtureUrl, readCapture, mockOrigin, companionDataDir,
  }, testInfo) => {
    const settings = await openExtensionPage('settings.html#diagnostics');
    await signInToMockChatGpt(context, settings);
    const setFailure = (body: string) => fetch(mockOrigin + '/test/wrap-up-failure', { method: 'POST', body });
    expect((await setFailure('on')).ok).toBe(true);
    const panel = await openExtensionPage('sidepanel.html');
    await panel.setViewportSize({ width: 400, height: 820 });
    const journal = await openExtensionPage('journal.html');
    const article = await context.newPage();
    await article.goto(fixtureUrl('learn.test', '/content/article.html'));
    await expect.poll(async () => (await readCapture('pages')).some(({ text }) => text.length > 0)).toBe(true);
    await article.locator('#highlight').selectText();
    await expect.poll(async () => (await readCapture('pages'))[0]?.summary).toContain('Tombstones retain deletion history');
    await panel.getByRole('button', { name: /^Wrap up expedition/ }).first().click();

    const diagnostics = settings.getByRole('region', { name: 'Model jobs' });
    const wrapUp = diagnostics.getByRole('region', { name: 'Expedition wrap-up' });
    const retry = wrapUp.getByRole('button', { name: 'Retry now' });
    for (const attempts of [1, 2, 3]) {
      await expect(wrapUp.getByText(new RegExp(`Attempts: ${attempts} · Next retry:`))).toBeVisible();
      await expect(wrapUp.getByText('usage_unavailable')).toBeVisible();
      if (attempts < 3) {
        await expect(panel.getByText(warning, { exact: true })).toHaveCount(0);
        await retry.click();
      }
    }
    await expect(panel.getByText(warning, { exact: true })).toBeVisible();
    await expect(journal.getByText(warning, { exact: true })).toBeVisible();
    await expect(journal.getByRole('link', { name: 'Details in Diagnostics' })).toHaveAttribute('href', '/settings.html#diagnostics');
    const failures = settings.getByRole('button', { name: /Expedition wrap-up.*Failed.*usage_unavailable/ });
    await expect(failures).toHaveCount(3);
    const lines = await readFile(join(companionDataDir, 'companion.log'), 'utf8');
    expect(lines.match(/llm\.complete failed provider=chatgpt code=usage_unavailable reason=http_status status=503/g)).toHaveLength(3);
    expect(lines).not.toContain('private provider detail');
    expect(lines).not.toContain('mock-access-0');
    // Capture diagnostic and attention states while the retry is still outstanding.
    const proof = (name: string) => process.env.PROOF_DIR ? join(process.env.PROOF_DIR, name) : testInfo.outputPath(name);
    await diagnostics.screenshot({ path: proof('model-jobs.png') });
    await panel.screenshot({ path: proof('attention.png') });

    expect((await setFailure('off')).ok).toBe(true);
    await retry.click();
    await expect.poll(async () => (await readCapture('expeditions'))[0]?.fieldNotes).toContain('## Key ideas');
    await expect(panel.getByText(warning, { exact: true })).toHaveCount(0);
    await expect(journal.getByText(warning, { exact: true })).toHaveCount(0);
    const success = settings.getByRole('button', { name: /Expedition wrap-up.*Succeeded/ });
    await success.click();
    const log = settings.getByRole('region', { name: 'Sent-to-model log' });
    await expect(log.getByRole('heading', { name: 'Returned', exact: true })).toBeVisible();
    await expect(log.getByText(/"title": "How replicated lists delete items"/)).toBeVisible();
    await log.screenshot({ path: proof('sent-to-model.png') });
  });
});

test('the Sent-to-model download exports the five newest calls, redacted by default, or the exact rows', async ({
  context, openExtensionPage, readCapture,
}) => {
  const setup = context.pages().find((page) => page.url().endsWith('/onboarding.html'))!;
  await readCapture('sentToModel');
  const jobId = 'matching-job';
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `audit-${i}`, at: 1000 + i, finishedAt: 2000 + i, task: 'expedition_wrap_up', provider: 'ChatGPT plan', model: 'Fixture',
    outcome: 'succeeded' as const, output: { title: `private reply ${i}` },
    instructions: `private instructions ${i}`, input: [{ role: 'user' as const, content: `private text ${i}` }],
    expeditionId: 'expedition', canonicalUrls: ['https://fixture.test/'], visitIds: ['visit'], jobId,
  }));
  await seedCapture(setup, { sentToModel: rows, jobs: [
    { id: jobId, key: 'job', kind: 'expedition_wrap_up', priority: 1, payload: { expeditionId: 'expedition', endedAt: 0, revision: 1 },
      status: 'failed', createdAt: 0, availableAt: 0, failures: 1, lastError: { code: 'invalid_output', attempts: 2, at: 1000 } },
  ] });
  const settings = await openExtensionPage('settings.html#sent-to-model');
  const log = settings.getByRole('region', { name: 'Sent-to-model log' });
  const count = log.getByLabel('Last calls');
  await expect(count).toHaveValue('20');
  const exportButton = log.getByRole('button', { name: 'Export', exact: true });
  await count.fill('0');
  await count.press('Tab');
  await expect(exportButton).toBeDisabled();
  await count.fill('50');
  await count.press('Tab');
  await expect(count).toHaveValue('20');
  await count.fill('5');
  await count.press('Tab');
  const download = async () => {
    const started = settings.waitForEvent('download');
    await exportButton.click();
    const file = await started;
    expect(file.suggestedFilename()).toMatch(/^trailmap-model-log-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const text = await readFile((await file.path())!, 'utf8');
    return { text, lines: text.trim().split('\n').map((line) => JSON.parse(line)) };
  };
  await expect(log.getByRole('checkbox', { name: 'Leave out page text' })).toBeChecked();
  const newest = rows.toReversed().slice(0, 5);
  const redacted = await download();
  expect(redacted.lines.map(({ id }) => id)).toEqual(newest.map(({ id }) => id));
  expect(redacted.text).not.toContain('private');
  const digest = (text: string) => ({ length: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
  expect(redacted.lines[0]).toMatchObject({ instructions: digest(newest[0]!.instructions),
    input: digest(JSON.stringify(newest[0]!.input)), output: digest(JSON.stringify(newest[0]!.output)) });
  await log.getByRole('checkbox', { name: 'Leave out page text' }).uncheck();
  await expect(log.getByText(/file will contain the text/)).toBeVisible();
  expect((await download()).lines).toEqual(newest);
  await log.getByRole('checkbox', { name: 'Include matching job diagnostics' }).check();
  const withDiagnostics = await download();
  expect(withDiagnostics.lines[0]).toMatchObject({ jobDiagnostics: { status: 'failed', lastError: { code: 'invalid_output', attempts: 2 } } });
  expect(withDiagnostics.lines[0].jobDiagnostics).not.toHaveProperty('payload');
});
