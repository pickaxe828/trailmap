/**
 * Companion entry point.
 *   trailmap-companion install|uninstall [--browser chromium|firefox|all] [--user-data-dir <dir>] [--mozilla-dir <dir>]
 *   trailmap-companion install [--binary <path>]   optional executable override
 *   trailmap-companion --version
 *   trailmap-companion <chrome-extension://id/> | <manifest path> <gecko id>   launched by the browser
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { GECKO_EXTENSION_ID } from '@trailmap/shared';
import { EXTENSION_ID } from '../../extension/extension-key';
import { COMPANION_VERSION, type CompanionContext } from './handle';
import { runHost } from './host';
import { type BrowserFamily, installManifests, MANIFEST_FILE, uninstallManifests } from './installer';
import { companionDataDir, createSecretStore } from './secrets';
import { Vault } from './vault';

const argv = process.argv.slice(2);
const command = argv[0];
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
const flag = (name: string) => {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (!value || value.startsWith('--')) return fail(`Invalid ${name}: expected a value`);
  return value;
};
const installEnv = {
  home: process.env.HOME ?? homedir(), platform: process.platform, configHome: process.env.XDG_CONFIG_HOME,
  macApplications: '/Applications', executablePath: process.env.PATH,
};

if (command === '--version') {
  console.log(COMPANION_VERSION);
} else if (command === 'install' || command === 'uninstall') {
  const choice = flag('--browser') ?? 'all';
  const browser: BrowserFamily = choice === 'all' || choice === 'firefox' || choice === 'chromium'
    ? choice : fail('Invalid --browser: use chromium, firefox or all');
  const action = command === 'install' ? 'Installed' : 'Removed';
  const options = {
    env: installEnv, browser, userDataDir: flag('--user-data-dir'), mozillaDir: flag('--mozilla-dir'),
    report: (file: string, label: string) => console.log(`${action} for ${label}: ${file}`),
  } as const;
  if (command === 'install') {
    const binaryPath = flag('--binary') ?? process.execPath;
    if (!isAbsolute(binaryPath)) fail('--binary must be an absolute path');
    if (/^(bun|bunx|node)$/.test(basename(binaryPath))) {
      fail('Run install from the compiled trailmap-companion binary (or pass --binary <path>): the browser has to launch the binary itself.');
    }
    if (!installManifests({ ...options, binaryPath, extensionId: EXTENSION_ID }).length) {
      const family = browser === 'chromium' ? ' Chromium-based' : browser === 'firefox' ? ' Firefox-family' : '';
      fail(`No${family} browser found. Use --user-data-dir <dir> for Chromium or --mozilla-dir <dir> for Firefox.`);
    }
  } else if (!uninstallManifests(options).length) {
    console.log('Nothing to remove.');
  }
} else {
  // Defense in depth: Chromium passes the origin first; Gecko passes the manifest path then the add-on ID.
  const chromiumCaller = command === `chrome-extension://${EXTENSION_ID}/`;
  const geckoCaller = argv.length === 2 && command !== undefined && isAbsolute(command) &&
    basename(command) === MANIFEST_FILE && argv[1] === GECKO_EXTENSION_ID;
  if (!chromiumCaller && !geckoCaller) {
    console.error('Refusing to serve an unknown caller');
    process.exit(2);
  }

  const dataDir = companionDataDir(process.env, installEnv.home);
  const logFile = join(dataDir, 'companion.log');
  // Chrome inherits the browser's stderr, which is usually lost, so diagnostics also go to a file. Never log secrets or page text.
  const log = (line: string) => {
    const entry = `${new Date().toISOString()} ${line}\n`;
    console.error(entry.trimEnd());
    try {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      appendFileSync(logFile, entry, { mode: 0o600 });
    } catch {
      // Logging must never take the host down.
    }
  };
  const ctx: CompanionContext = {
    env: process.env,
    secrets: createSecretStore({ platform: process.platform, env: process.env, dataDir }),
    log,
    vault: new Vault(dataDir),
  };
  log(`host started (v${COMPANION_VERSION})`);
  const ok = await runHost(
    process.stdin as unknown as AsyncIterable<Uint8Array>,
    (frame) => void process.stdout.write(frame),
    ctx,
  );
  process.exit(ok ? 0 : 1);
}
