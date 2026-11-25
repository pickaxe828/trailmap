/** Runs the real CLI entry point: `trailmap-companion install|uninstall`. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_ID } from '../../extension/extension-key';

const MAIN = new URL('./main.ts', import.meta.url).pathname;
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'trailmap-cli-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

async function cli(...args: string[]) {
  const proc = Bun.spawn(['bun', MAIN, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') } });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

test('install --user-data-dir writes a manifest for the pinned extension ID, uninstall removes it', async () => {
  const profile = join(home, 'profile');
  const manifest = join(profile, 'NativeMessagingHosts', 'com.trailmap.companion.json');

  const installed = await cli('install', '--user-data-dir', profile, '--binary', '/opt/trailmap-companion');
  expect(installed.code).toBe(0);
  expect(installed.stdout).toContain(manifest);
  expect(JSON.parse(readFileSync(manifest, 'utf8'))).toMatchObject({
    name: 'com.trailmap.companion',
    path: '/opt/trailmap-companion',
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  });

  const removed = await cli('uninstall', '--user-data-dir', profile);
  expect(removed.code).toBe(0);
  expect(existsSync(manifest)).toBe(false);
});

test('install into every detected browser (HOME is temporary, so nothing real is touched)', async () => {
  const chrome = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Google', 'Chrome') : join(home, '.config', 'google-chrome');
  mkdirSync(chrome, { recursive: true });
  const result = await cli('install', '--binary', '/opt/trailmap-companion');
  expect(result.code).toBe(0);
  expect(existsSync(join(chrome, 'NativeMessagingHosts', 'com.trailmap.companion.json'))).toBe(true);
});

test('install says so, and fails, when no browser is found', async () => {
  const result = await cli('install', '--binary', '/opt/trailmap-companion');
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('No Chromium-based browser found');
});

test('install refuses to register a relative or interpreter path, which the browser could not launch', async () => {
  const profile = join(home, 'profile');
  expect((await cli('install', '--user-data-dir', profile, '--binary', 'relative/path')).code).toBe(1);
  // Run from source, process.execPath is `bun` itself: not a companion binary.
  const fromSource = await cli('install', '--user-data-dir', profile);
  expect(fromSource.code).toBe(1);
  expect(fromSource.stderr).toContain('compiled');
  expect(existsSync(profile)).toBe(false);
});
