import type { BrowserContext, Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, test as base } from './fixtures';

export async function signInToMockChatGpt(context: BrowserContext, setup: Page) {
  const opened = context.waitForEvent('page');
  await setup.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  const callback = await opened;
  await expect(callback.getByText('Signed in. You can close this tab.')).toBeVisible();
  await expect(setup.getByText('Signed in as reader@example.test · plan usage on')).toBeVisible();
  return callback;
}

const script = fileURLToPath(new URL('./mock-page-summary.ts', import.meta.url));
export const test = base.extend<{ mockOrigin: string; chatGptModels: string[] }>({
  chatGptModels: [[], { option: true }],
  mockOrigin: async ({ chatGptModels }, use) => {
    const child = spawn('bun', [script, ...chatGptModels], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = once(child, 'exit');
    const lines = createInterface({ input: child.stdout });
    try {
      const [origin] = await Promise.race([
        once(lines, 'line'),
        exited.then(() => { throw new Error('Mock model server exited without an origin'); }),
      ]);
      await use(origin);
    } finally {
      lines.close();
      child.kill();
      await exited;
    }
  },
  companionEnv: async ({ companionEnv, mockOrigin }, use) => {
    await use({ ...companionEnv, TRAILMAP_OPENAI_AUTH_BASE_URL: mockOrigin, TRAILMAP_OPENAI_BASE_URL: mockOrigin + '/v1' });
  },
});
