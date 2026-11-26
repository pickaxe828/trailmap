import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, test as base } from './fixtures';
import { signInToMockChatGpt } from './model-fixtures';

const script = fileURLToPath(new URL('../packages/companion/src/auth/mock-oauth.ts', import.meta.url));
const test = base.extend<{ oauthOrigin: string }>({
  oauthOrigin: async ({}, use) => {
    const process = spawn('bun', [script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = once(process, 'exit');
    const lines = createInterface({ input: process.stdout });
    try {
      const [origin] = await Promise.race([
        once(lines, 'line'),
        exited.then(() => { throw new Error('Mock OAuth server exited before printing its origin'); }),
      ]);
      await use(origin);
    } finally {
      lines.close();
      process.kill();
      await exited;
    }
  },
  companionEnv: async ({ companionEnv, oauthOrigin }, use) => {
    await use({
      ...companionEnv,
      TRAILMAP_OPENAI_AUTH_BASE_URL: oauthOrigin,
      TRAILMAP_OPENAI_BASE_URL: oauthOrigin + '/v1',
    });
  },
});

test.use({ companionInstalled: true });

test('sign in from both Settings and onboarding using the same ChatGPT connection', async ({
  context, openExtensionPage, readVisits,
}, testInfo) => {
  await context.route(/^https:\/\/(auth\.openai\.com|api\.openai\.com|chatgpt\.com)\//, (route) => route.abort());
  const settings = await openExtensionPage('settings.html#model-providers');
  const onboarding = await openExtensionPage('onboarding.html');
  await onboarding.getByRole('button', { name: 'Next: AI notes' }).click();
  await onboarding.getByRole('button', { name: 'Next: Model providers' }).click();

  const callback = await signInToMockChatGpt(context, settings);
  const signedIn = 'Signed in as reader@example.test · plan usage on';
  await expect(onboarding.getByText(signedIn)).toBeVisible();
  await callback.screenshot({ path: testInfo.outputPath('sign-in-callback.png') });
  expect((await readVisits()).some(({ url }) => /\/api\/accounts\/authorize|\/auth\/callback/.test(url))).toBe(false);

  await onboarding.getByRole('button', { name: 'Sign out' }).click();
  await expect(settings.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  await signInToMockChatGpt(context, onboarding);
  await expect(settings.getByText(signedIn)).toBeVisible();
  await onboarding.screenshot({ path: testInfo.outputPath('onboarding-signed-in.png') });
});
