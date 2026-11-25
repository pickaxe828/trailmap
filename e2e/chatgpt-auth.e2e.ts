import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, test as base } from './fixtures';

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

test('sign in from the side panel and sign out from onboarding', async ({
  context, openExtensionPage, readVisits,
}, testInfo) => {
  await context.route(/^https:\/\/(auth\.openai\.com|api\.openai\.com|chatgpt\.com)\//, (route) => route.abort());
  const panel = await openExtensionPage('sidepanel.html');
  await panel.setViewportSize({ width: 360, height: 720 });
  const onboarding = await openExtensionPage('onboarding.html');
  const signIn = panel.getByRole('button', { name: 'Continue with ChatGPT' });
  await expect(signIn).toBeEnabled();
  await panel.screenshot({ path: testInfo.outputPath('side-panel-sign-in.png') });

  const opened = context.waitForEvent('page');
  await signIn.click();
  const callback = await opened;
  await expect(callback.getByText('Signed in. You can close this tab.')).toBeVisible();
  const signedIn = 'Signed in as reader@example.test · plan usage on';
  await expect(panel.getByText(signedIn)).toBeVisible();
  await expect(onboarding.getByText(signedIn)).toBeVisible();
  await callback.screenshot({ path: testInfo.outputPath('sign-in-callback.png') });
  await panel.screenshot({ path: testInfo.outputPath('side-panel-signed-in.png') });
  await onboarding.screenshot({ path: testInfo.outputPath('onboarding-signed-in.png') });
  expect((await readVisits()).some(({ url }) => /\/api\/accounts\/authorize|\/auth\/callback/.test(url))).toBe(false);

  await onboarding.getByRole('button', { name: 'Sign out' }).click();
  await expect(signIn).toBeEnabled();
  const signInFromOnboarding = onboarding.getByRole('button', { name: 'Continue with ChatGPT' });
  await expect(signInFromOnboarding).toBeEnabled();
  const reopened = context.waitForEvent('page');
  await signInFromOnboarding.click();
  await expect((await reopened).getByText('Signed in. You can close this tab.')).toBeVisible();
  await expect(panel.getByText(signedIn)).toBeVisible();
});
