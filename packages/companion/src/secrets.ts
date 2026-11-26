/**
 * Secret store for the companion (API keys, ChatGPT tokens: docs/PLAN.md §8).
 * macOS: the login Keychain through the `security` CLI. Elsewhere, and in
 * tests (`TRAILMAP_SECRET_STORE=file`): a JSON file with 0600 permissions.
 * Secrets never leave the companion: no message returns one.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { withFileLock } from './file-lock';

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
  lockChatGptAccount<T>(work: () => Promise<T>): Promise<T>;
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly path: string) {}

  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>;
  }

  private write(secrets: Record<string, string>) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    // Write a private temp file then rename, so the secrets are never briefly world-readable or half-written.
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }

  async get(account: string) {
    return this.read()[account] ?? null;
  }

  async set(account: string, value: string) {
    await withFileLock(`${this.path}.lock`, async () => { this.write({ ...this.read(), [account]: value }); });
  }

  async delete(account: string) {
    await withFileLock(`${this.path}.lock`, async () => {
      const secrets = this.read();
      if (!(account in secrets)) return;
      delete secrets[account];
      this.write(secrets);
    });
  }

  lockChatGptAccount<T>(work: () => Promise<T>) {
    return withFileLock(`${this.path}.chatgpt.lock`, work);
  }
}

export type SecurityRunner = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

const runSecurity: SecurityRunner = async (args, stdin) => {
  const proc = Bun.spawn(['security', ...args], {
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
};

const NOT_FOUND = 44; // `security`'s exit code for "item could not be found"

export class KeychainSecretStore implements SecretStore {
  private readonly service: string;
  private readonly run: SecurityRunner;

  constructor({ service = 'com.trailmap.companion', run = runSecurity }: { service?: string; run?: SecurityRunner } = {}) {
    this.service = service;
    this.run = run;
  }

  async get(account: string) {
    const { code, stdout } = await this.run(['find-generic-password', '-s', this.service, '-a', account, '-w']);
    if (code === NOT_FOUND) return null;
    if (code !== 0) throw new Error('Keychain read failed');
    return Buffer.from(stdout.trim(), 'base64').toString('utf8');
  }

  async set(account: string, value: string) {
    // `security -i` reads its command from stdin, so the secret never appears in `ps`. The value is base64 so
    // it needs no quoting and is always printable ASCII (`-w` would print non-ASCII as hex).
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    const { code } = await this.run(
      ['-i'],
      `add-generic-password -U -s ${this.service} -a ${encodeAccount(account)} -w ${encoded}\n`,
    );
    if (code !== 0) throw new Error('Keychain write failed');
  }

  async delete(account: string) {
    const { code } = await this.run(['delete-generic-password', '-s', this.service, '-a', account]);
    if (code !== 0 && code !== NOT_FOUND) throw new Error('Keychain delete failed');
  }

  lockChatGptAccount<T>(work: () => Promise<T>) {
    // Keychain accounts are shared even if the hosts use different data dirs.
    return withFileLock(join(homedir(), '.trailmap', 'chatgpt-keychain.lock'), work);
  }
}

/** Account names are our own fixed identifiers; refuse anything that would need quoting. */
function encodeAccount(account: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(account)) throw new Error('Invalid secret account name');
  return account;
}

/** Where the companion keeps its own files (secret file, log): `~/.trailmap`, or `TRAILMAP_COMPANION_DATA_DIR`. */
export function companionDataDir(env: Record<string, string | undefined>, home: string): string {
  return env.TRAILMAP_COMPANION_DATA_DIR ?? join(home, '.trailmap');
}

export function createSecretStore({
  platform,
  env,
  dataDir,
}: {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  dataDir: string;
}): SecretStore {
  const kind = env.TRAILMAP_SECRET_STORE ?? (platform === 'darwin' ? 'keychain' : 'file');
  return kind === 'keychain' ? new KeychainSecretStore() : new FileSecretStore(join(dataDir, 'secrets.json'));
}

