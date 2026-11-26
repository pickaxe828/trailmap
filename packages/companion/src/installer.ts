/** User-level Native Messaging registration on macOS and Linux (docs/PLAN.md §6.1). */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GECKO_EXTENSION_ID, NATIVE_HOST_NAME } from '@trailmap/shared';

export interface InstallEnv {
  home: string;
  platform: NodeJS.Platform;
  /** Linux only: replaces ~/.config (XDG_CONFIG_HOME). */
  configHome?: string;
  /** Additional application locations used by the CLI, beyond ~/Applications. */
  macApplications?: string;
  executablePath?: string;
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

export type BrowserFamily = 'chromium' | 'firefox' | 'all';

interface ManifestOptions {
  env: InstallEnv;
  browser?: BrowserFamily;
  /** Use this Chromium user-data directory instead of detecting Chromium profiles. */
  userDataDir?: string;
  /** Use this Gecko parent directory instead of detecting Firefox-family locations. */
  mozillaDir?: string;
  report?: (file: string, browser: string) => void;
}

interface ManifestTarget {
  file: string;
  label: string;
  gecko: boolean;
}

const GECKO_BROWSERS = [
  { name: 'Firefox', app: 'Firefox', bin: ['firefox', 'firefox-esr'], macProfiles: ['Firefox'], linuxProfiles: ['mozilla/firefox'] },
  { name: 'Zen', app: 'Zen', bin: ['zen', 'zen-browser'], macProfiles: ['zen'], linuxProfiles: ['zen'] },
  { name: 'Floorp', app: 'Floorp', bin: ['floorp'], macProfiles: ['Floorp'], linuxProfiles: ['floorp', 'mozilla/floorp'] },
  { name: 'LibreWolf', app: 'LibreWolf', bin: ['librewolf'], macProfiles: ['LibreWolf'], linuxProfiles: ['librewolf'] },
] as const;

function geckoTargets({ env, mozillaDir }: ManifestOptions, uninstall: boolean): ManifestTarget[] {
  const mac = env.platform === 'darwin';
  const { home } = env;
  const root = mac ? join(home, 'Library', 'Application Support') : home;
  const hostDir = mac ? 'NativeMessagingHosts' : 'native-messaging-hosts';
  const target = (dir: string, label: string): ManifestTarget => ({ file: join(dir, hostDir, MANIFEST_FILE), label, gecko: true });
  if (mozillaDir !== undefined) return [target(mozillaDir, 'Firefox family')];

  const detected = GECKO_BROWSERS.filter((b) => mac
    ? b.macProfiles.some((dir) => existsSync(join(root, dir))) ||
      [join(home, 'Applications'), env.macApplications].some((dir) => dir && existsSync(join(dir, `${b.app}.app`)))
    : b.linuxProfiles.some((dir) => existsSync(join(home, `.${dir}`)) || existsSync(join(env.configHome ?? join(home, '.config'), dir))) ||
      (env.executablePath && b.bin.some((bin) => Bun.which(bin, { PATH: env.executablePath }))));
  // Zen 1.24.3b uses Mozilla even though its profile lives elsewhere. LibreWolf
  // has its own directory, with a Mozilla fallback in recent builds.
  const shared = target(join(root, mac ? 'Mozilla' : '.mozilla'), detected.map((b) => b.name).join(' / ') || 'Firefox family');
  const librewolf = target(join(root, mac ? 'LibreWolf' : '.librewolf'), 'LibreWolf');
  return uninstall ? [shared, librewolf] : [
    ...(detected.length ? [shared] : []),
    ...(detected.some((b) => b.name === 'LibreWolf') ? [librewolf] : []),
  ];
}

function manifestTargets(options: ManifestOptions, uninstall = false): ManifestTarget[] {
  const { env, browser = 'all', userDataDir } = options;
  if (env.platform !== 'darwin' && env.platform !== 'linux') throw new Error('Trailmap companion install supports macOS and Linux only');
  const targets: ManifestTarget[] = [];
  if (browser !== 'firefox') {
    const chromium = userDataDir !== undefined ? [userDataDir] : detectBrowserDataDirs(env);
    targets.push(...chromium.map((dir) => ({ file: join(dir, 'NativeMessagingHosts', MANIFEST_FILE), label: 'Chromium', gecko: false })));
  }
  if (browser !== 'chromium') targets.push(...geckoTargets(options, uninstall));
  return targets;
}

export interface InstallOptions extends ManifestOptions {
  /** Absolute path of the companion binary the browser should launch. */
  binaryPath: string;
  extensionId: string;
}

/** Returns the manifest paths written. */
export function installManifests(options: InstallOptions): string[] {
  const common = { name: NATIVE_HOST_NAME, description: 'Trailmap companion', path: options.binaryPath, type: 'stdio' };
  const chromium = { ...common, allowed_origins: [`chrome-extension://${options.extensionId}/`] };
  const gecko = { ...common, allowed_extensions: [GECKO_EXTENSION_ID] };
  return manifestTargets(options).map(({ file, label, gecko: isGecko }) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(isGecko ? gecko : chromium, null, 2)}\n`);
    options.report?.(file, label);
    return file;
  });
}

/** Returns the manifest paths removed. Removes only our own file, never other hosts' manifests. */
export function uninstallManifests(options: ManifestOptions): string[] {
  return manifestTargets(options, true)
    .filter(({ file }) => existsSync(file))
    .map(({ file, label }) => {
      rmSync(file);
      options.report?.(file, label);
      return file;
    });
}

