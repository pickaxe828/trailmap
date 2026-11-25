/**
 * Companion entry point.
 *   trailmap-companion install [--user-data-dir <dir>] [--binary <path>]
 *   trailmap-companion uninstall [--user-data-dir <dir>]
 *   trailmap-companion --version
 *   trailmap-companion [chrome-extension://<id>/]   host mode, launched by the browser
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { EXTENSION_ID } from '../../extension/extension-key';
import { COMPANION_VERSION, type CompanionContext } from './handle';
import { runHost } from './host';
import { installManifests, uninstallManifests } from './installer';
import { companionDataDir, createSecretStore } from './secrets';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name: string) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
const installEnv = { home: process.env.HOME ?? homedir(), platform: process.platform, configHome: process.env.XDG_CONFIG_HOME };

if (command === '--version') {
  console.log(COMPANION_VERSION);
} else if (command === 'install') {
  const binaryPath = flag('--binary') ?? process.execPath;
  if (!isAbsolute(binaryPath)) fail('--binary must be an absolute path');
  if (/^(bun|bunx|node)$/.test(basename(binaryPath))) {
    fail('Run install from the compiled trailmap-companion binary (or pass --binary <path>): the browser has to launch the binary itself.');
  }
  const written = installManifests({ env: installEnv, binaryPath, extensionId: EXTENSION_ID, userDataDir: flag('--user-data-dir') });
  if (written.length === 0) fail('No Chromium-based browser found. Use --user-data-dir <dir> to install into a specific profile folder.');
  for (const file of written) console.log(`Installed ${file}`);
} else if (command === 'uninstall') {
  const removed = uninstallManifests({ env: installEnv, userDataDir: flag('--user-data-dir') });
  for (const file of removed) console.log(`Removed ${file}`);
  if (removed.length === 0) console.log('Nothing to remove.');
} else {
  // Host mode. Chrome passes the caller's origin as the first argument; refuse anyone but Trailmap
  // (the manifest's allowed_origins already enforces this: this is defence in depth).
  const origin = argv.find((a) => a.startsWith('chrome-extension://'));
  if (origin !== undefined && origin !== `chrome-extension://${EXTENSION_ID}/`) {
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
  };
  const ok = await runHost(
    process.stdin as unknown as AsyncIterable<Uint8Array>,
    (frame) => void process.stdout.write(frame),
    ctx,
  );
  process.exit(ok ? 0 : 1);
}
