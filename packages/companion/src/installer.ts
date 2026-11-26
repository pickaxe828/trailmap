/**
 * Writes and removes the Native Messaging host manifest (docs/PLAN.md §6.1).
 * Chrome looks for it in `<browser user-data-dir>/NativeMessagingHosts/`, so we
 * write into the folder of every Chromium-family browser we can see on macOS
 * and Linux, or into one `--user-data-dir` (what tests use).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NATIVE_HOST_NAME } from '@trailmap/shared';

export interface InstallEnv {
  home: string;
  platform: NodeJS.Platform;
  /** Linux only: replaces ~/.config (XDG_CONFIG_HOME). */
  configHome?: string;
}

/** Browser user-data-dir, relative to `~/Library/Application Support` (macOS) or the config home (Linux). */
const BROWSERS: ReadonlyArray<{ name: string; mac: string; linux: string }> = [
  { name: 'Chrome', mac: 'Google/Chrome', linux: 'google-chrome' },
  { name: 'Chrome Beta', mac: 'Google/Chrome Beta', linux: 'google-chrome-beta' },
  { name: 'Chrome Canary', mac: 'Google/Chrome Canary', linux: 'google-chrome-unstable' },
  { name: 'Chromium', mac: 'Chromium', linux: 'chromium' },
  { name: 'Brave', mac: 'BraveSoftware/Brave-Browser', linux: 'BraveSoftware/Brave-Browser' },
  { name: 'Edge', mac: 'Microsoft Edge', linux: 'microsoft-edge' },
  { name: 'Arc', mac: 'Arc/User Data', linux: '' }, // macOS only
  { name: 'Vivaldi', mac: 'Vivaldi', linux: 'vivaldi' },
  { name: 'Helium', mac: 'net.imput.helium', linux: 'net.imput.helium' }, // Folder named after its bundle identifier
];

export const MANIFEST_FILE = `${NATIVE_HOST_NAME}.json`;

/** User-data dirs of the browsers that exist on this machine. */
export function detectBrowserDataDirs(env: InstallEnv): string[] {
  let root: string;
  if (env.platform === 'darwin') root = join(env.home, 'Library', 'Application Support');
  else if (env.platform === 'linux') root = env.configHome ?? join(env.home, '.config');
  else throw new Error('Trailmap companion install supports macOS and Linux only');

  return BROWSERS.map((b) => (env.platform === 'darwin' ? b.mac : b.linux))
    .filter((rel) => rel !== '')
    .map((rel) => join(root, rel))
    .filter((dir) => existsSync(dir));
}

const manifestPath = (dataDir: string) => join(dataDir, 'NativeMessagingHosts', MANIFEST_FILE);

export interface InstallOptions {
  env: InstallEnv;
  /** Absolute path of the companion binary the browser should launch. */
  binaryPath: string;
  extensionId: string;
  /** Install into this one browser profile folder (created if missing) instead of every detected browser. */
  userDataDir?: string;
}

/** Returns the manifest paths written. */
export function installManifests({ env, binaryPath, extensionId, userDataDir }: InstallOptions): string[] {
  const targets = userDataDir !== undefined ? [userDataDir] : detectBrowserDataDirs(env);
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'Trailmap companion',
    path: binaryPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  return targets.map((dir) => {
    const file = manifestPath(dir);
    mkdirSync(join(dir, 'NativeMessagingHosts'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    return file;
  });
}

/** Returns the manifest paths removed. Removes only our own file, never other hosts' manifests. */
export function uninstallManifests({ env, userDataDir }: { env: InstallEnv; userDataDir?: string }): string[] {
  const targets = userDataDir !== undefined ? [userDataDir] : detectBrowserDataDirs(env);
  return targets
    .map(manifestPath)
    .filter((file) => existsSync(file))
    .map((file) => {
      rmSync(file);
      return file;
    });
}

