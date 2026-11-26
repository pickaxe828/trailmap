import { defineConfig } from '@playwright/test';
import { FIXTURE_PORT } from './constants';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  // One persistent browser profile per test; extensions need a real (non-shell) Chromium.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000, // the first browser launch on a cold profile can take a while
  webServer: {
    command: 'bun fixture-server.ts', // cwd is the config's folder (e2e/),
    port: FIXTURE_PORT,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
