import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test as base } from './fixtures';

const script = fileURLToPath(new URL('./mock-page-summary.ts', import.meta.url));
export const test = base.extend<{ mockOrigin: string }>({
  mockOrigin: async ({}, use) => {
    const child = spawn('bun', [script], { stdio: ['ignore', 'pipe', 'inherit'] });
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
