import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installManifests, uninstallManifests, type InstallEnv } from './installer';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const BIN = '/opt/trailmap/trailmap-companion';
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'trailmap-home-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const mac = (): InstallEnv => ({ home, platform: 'darwin' });
const linux = (extra: Partial<InstallEnv> = {}): InstallEnv => ({ home, platform: 'linux', ...extra });
const support = (...parts: string[]) => join(home, 'Library', 'Application Support', ...parts);
const manifestIn = (dir: string) => join(dir, 'NativeMessagingHosts', 'com.trailmap.companion.json');
const mkdirs = (...dirs: string[]) => dirs.forEach((d) => mkdirSync(d, { recursive: true }));

test('install writes the host manifest into every macOS Chromium browser that is present, and only those', () => {
  const present = [
    support('Google', 'Chrome'),
    support('Google', 'Chrome Beta'),
    support('Google', 'Chrome Canary'),
    support('Chromium'),
    support('BraveSoftware', 'Brave-Browser'),
    support('Microsoft Edge'),
    support('Arc', 'User Data'),
  ];
  mkdirs(...present); // Vivaldi deliberately absent

  const written = installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT });

  expect(written.sort()).toEqual(present.map(manifestIn).sort());
  expect(existsSync(support('Vivaldi'))).toBe(false);
  expect(JSON.parse(readFileSync(manifestIn(support('Google', 'Chrome')), 'utf8'))).toEqual({
    name: 'com.trailmap.companion',
    description: 'Trailmap companion',
    path: BIN,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXT}/`],
  });
});

test('install also covers Vivaldi when it is the browser present', () => {
  mkdirs(support('Vivaldi'));
  expect(installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT })).toEqual([manifestIn(support('Vivaldi'))]);
});

test('install covers Helium, which keeps its profile under its bundle identifier', () => {
  mkdirs(support('net.imput.helium'));
  expect(installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT })).toEqual([manifestIn(support('net.imput.helium'))]);
  mkdirs(join(home, '.config', 'net.imput.helium'));
  expect(installManifests({ env: linux(), binaryPath: BIN, extensionId: EXT })).toEqual([manifestIn(join(home, '.config', 'net.imput.helium'))]);
});

test('install finds the Linux browser folders under ~/.config, honouring XDG_CONFIG_HOME', () => {
  mkdirs(join(home, '.config', 'google-chrome'), join(home, '.config', 'chromium'), join(home, '.config', 'BraveSoftware', 'Brave-Browser'), join(home, '.config', 'microsoft-edge'), join(home, '.config', 'vivaldi'));
  const written = installManifests({ env: linux(), binaryPath: BIN, extensionId: EXT });
  expect(written.length).toBe(5);
  expect(written).toContain(manifestIn(join(home, '.config', 'google-chrome')));

  const xdg = join(home, 'xdg');
  mkdirs(join(xdg, 'chromium'));
  expect(installManifests({ env: linux({ configHome: xdg }), binaryPath: BIN, extensionId: EXT })).toEqual([manifestIn(join(xdg, 'chromium'))]);
});

test('with --user-data-dir only that profile folder is written (and created if missing); detected browsers are left alone', () => {
  mkdirs(support('Google', 'Chrome'));
  const profile = join(home, 'pw-profile'); // does not exist yet
  const written = installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT, userDataDir: profile });
  expect(written).toEqual([manifestIn(profile)]);
  expect(existsSync(manifestIn(support('Google', 'Chrome')))).toBe(false);
});

test('installing again replaces the manifest, for example when the binary moved', () => {
  mkdirs(support('Chromium'));
  installManifests({ env: mac(), binaryPath: '/old/path', extensionId: EXT });
  installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT });
  expect(JSON.parse(readFileSync(manifestIn(support('Chromium')), 'utf8')).path).toBe(BIN);
});

test('install with no browsers present writes nothing', () => {
  expect(installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT })).toEqual([]);
});

test('uninstall removes our manifest from every browser and leaves other hosts alone', () => {
  mkdirs(support('Google', 'Chrome'), support('Chromium'));
  installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT });
  const other = join(support('Chromium'), 'NativeMessagingHosts', 'com.other.host.json');
  writeFileSync(other, '{}');

  const removed = uninstallManifests({ env: mac() });

  expect(removed.sort()).toEqual([manifestIn(support('Chromium')), manifestIn(support('Google', 'Chrome'))].sort());
  expect(existsSync(manifestIn(support('Google', 'Chrome')))).toBe(false);
  expect(existsSync(other)).toBe(true);
  expect(uninstallManifests({ env: mac() })).toEqual([]); // idempotent
});

test('uninstall with --user-data-dir removes only that profile manifest', () => {
  mkdirs(support('Chromium'));
  const profile = join(home, 'pw-profile');
  installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT });
  installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT, userDataDir: profile });

  expect(uninstallManifests({ env: mac(), userDataDir: profile })).toEqual([manifestIn(profile)]);
  expect(existsSync(manifestIn(support('Chromium')))).toBe(true);
});

test('the default installs both manifest formats and shares Mozilla between Firefox and Zen on macOS', () => {
  mkdirs(support('Google', 'Chrome'), support('zen'), support('Firefox'));
  const paths = installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT });
  const gecko = manifestIn(support('Mozilla'));
  expect(paths).toEqual([manifestIn(support('Google', 'Chrome')), gecko]);
  expect(JSON.parse(readFileSync(gecko, 'utf8'))).toEqual({
    name: 'com.trailmap.companion', description: 'Trailmap companion', path: BIN,
    type: 'stdio', allowed_extensions: ['trailmap@pickaxe828'],
  });
  expect(existsSync(manifestIn(support('zen')))).toBe(false);
  expect(uninstallManifests({ env: mac() })).toEqual(paths);
});

test('Firefox-family application bundles are detected without a profile, including LibreWolf’s own folder', () => {
  mkdirs(join(home, 'Applications', 'LibreWolf.app'), join(home, 'Applications', 'Floorp.app'));
  const paths = installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT, browser: 'firefox' });
  expect(paths).toEqual([manifestIn(support('Mozilla')), manifestIn(support('LibreWolf'))]);
});

test.each(['firefox', 'zen', 'floorp', 'librewolf'] as const)('detects the %s Linux profile and uses the Gecko path(s)', (browser) => {
  const xdg = join(home, 'xdg');
  mkdirs(browser === 'firefox' ? join(xdg, 'mozilla', 'firefox') : join(xdg, browser));
  const expected = [join(home, '.mozilla', 'native-messaging-hosts', 'com.trailmap.companion.json')];
  if (browser === 'librewolf') expected.push(join(home, '.librewolf', 'native-messaging-hosts', 'com.trailmap.companion.json'));
  const env = linux({ configHome: xdg });
  expect(installManifests({ env, binaryPath: BIN, extensionId: EXT, browser: 'firefox' })).toEqual(expected);
  expect(uninstallManifests({ env, browser: 'firefox' })).toEqual(expected);
});

test.each(['chromium', 'firefox', 'all'] as const)('--browser %s scopes install and uninstall with both directory overrides', (browser) => {
  mkdirs(support('Google', 'Chrome'), support('zen'));
  const userDataDir = join(home, 'custom-chrome');
  const mozillaDir = join(home, 'custom-mozilla');
  const options = { env: mac(), browser, userDataDir, mozillaDir };
  const expected = [
    ...(browser === 'firefox' ? [] : [manifestIn(userDataDir)]),
    ...(browser === 'chromium' ? [] : [manifestIn(mozillaDir)]),
  ];
  expect(installManifests({ ...options, binaryPath: BIN, extensionId: EXT })).toEqual(expected);
  expect(existsSync(manifestIn(support('Mozilla')))).toBe(false);
  expect(existsSync(manifestIn(support('Google', 'Chrome')))).toBe(false);
  expect(uninstallManifests(options)).toEqual(expected);
});

test('uninstall --browser firefox leaves installed Chromium manifests alone', () => {
  mkdirs(support('Google', 'Chrome'), support('zen'));
  installManifests({ env: mac(), binaryPath: BIN, extensionId: EXT });
  expect(uninstallManifests({ env: mac(), browser: 'firefox' })).toEqual([manifestIn(support('Mozilla'))]);
  expect(existsSync(manifestIn(support('Google', 'Chrome')))).toBe(true);
});

test('uninstall cleans up Gecko manifests after the last detected browser is removed', () => {
  const env = linux();
  const path = join(home, '.librewolf', 'native-messaging-hosts', 'com.trailmap.companion.json');
  mkdirs(join(home, '.librewolf', 'native-messaging-hosts'));
  writeFileSync(path, '{}');
  expect(uninstallManifests({ env, browser: 'firefox' })).toEqual([path]);
});

test('unsupported platforms are refused rather than guessed', () => {
  expect(() => installManifests({ env: { home, platform: 'win32' as never }, binaryPath: BIN, extensionId: EXT })).toThrow(/macOS and Linux/);
});
