/**
 * Secret store for the companion (API keys, ChatGPT tokens: docs/PLAN.md §8).
 * macOS: encrypted files with a data key in the login Keychain. Elsewhere,
 * and with `TRAILMAP_SECRET_STORE=file`: a JSON file with 0600 permissions.
 * Secrets never leave the companion: no message returns one.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { withFileLock } from './file-lock';

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
  lockChatGptAccount<T>(work: () => Promise<T>): Promise<T>;
}

function readIfPresent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function writePrivateFile(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly path: string) {}

  private read(): Record<string, string> {
    const stored = readIfPresent(this.path);
    return stored === null ? {} : JSON.parse(stored.toString('utf8')) as Record<string, string>;
  }

  private write(secrets: Record<string, string>) {
    writePrivateFile(this.path, JSON.stringify(secrets));
  }

  async get(account: string) {
    return this.read()[account] ?? null;
  }

  async set(account: string, value: string) {
    await withFileLock(`${this.path}.lock`, async () => {
      this.write({ ...this.read(), [account]: value });
      if (await this.get(account) !== value) throw new Error('Secret file write verification failed');
    });
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
const DATA_KEY = 'trailmap.data-key';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class KeychainSecretStore implements SecretStore {
  private readonly service: string;
  private readonly run: SecurityRunner;
  private readonly directory: string;

  constructor({
    service = 'com.trailmap.companion', run = runSecurity, dataDir = join(homedir(), '.trailmap'),
  }: { service?: string; run?: SecurityRunner; dataDir?: string } = {}) {
    this.service = safeName(service);
    this.run = run;
    this.directory = join(dataDir, 'keychain-secrets');
  }

  async get(account: string) {
    const encrypted = await this.readEncrypted(account, this.path(account));
    if (encrypted !== null) return encrypted;
    const legacy = await this.readKeychain(account);
    return legacy === null ? null : Buffer.from(legacy, 'base64').toString('utf8');
  }

  async set(account: string, value: string) {
    const path = this.path(account);
    await this.lockWrites(async () => {
      const key = await this.readDataKey() ?? await this.createDataKey();
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(this.associatedData(account));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      // File format: 12-byte nonce, 16-byte authentication tag, then ciphertext.
      writePrivateFile(path, Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]));
      const verified = await this.readEncrypted(account, path).catch((cause) => {
        throw new Error('Encrypted secret write verification failed', { cause });
      });
      if (verified !== value) throw new Error('Encrypted secret write verification failed');
      await this.deleteKeychain(account); // Don't leave an older secret available as a fallback.
    });
  }

  async delete(account: string) {
    const path = this.path(account);
    await this.lockWrites(async () => {
      await this.deleteKeychain(account);
      // No decryption required: a damaged ciphertext must still be removable.
      rmSync(path, { force: true });
    });
  }

  lockChatGptAccount<T>(work: () => Promise<T>) {
    // Keep the same lock across browser hosts, including hosts still using legacy Keychain items.
    return withFileLock(join(homedir(), '.trailmap', 'chatgpt-keychain.lock'), work);
  }

  private lockWrites<T>(work: () => Promise<T>) {
    // Key creation must be serialized even across different companion data dirs.
    return withFileLock(join(homedir(), '.trailmap', 'keychain-secrets.lock'), work);
  }

  private path(account: string): string {
    if (account === DATA_KEY) throw new Error('Reserved secret account name');
    // Keep Keychain identifiers distinct on case-insensitive APFS volumes.
    const name = createHash('sha256').update(`${this.service}:${safeName(account)}`).digest('hex');
    return join(this.directory, `${name}.enc`);
  }

  private associatedData(account: string): Buffer {
    return Buffer.from(`trailmap:secret:v1:${this.service}:${account}`);
  }

  private async readEncrypted(account: string, path: string): Promise<string | null> {
    const stored = readIfPresent(path);
    if (stored === null) return null;
    if (stored.length < NONCE_BYTES + TAG_BYTES) throw new Error('Encrypted secret is truncated');
    const key = await this.readDataKey();
    if (!key) throw new Error('Keychain data key is missing');
    const decipher = createDecipheriv('aes-256-gcm', key, stored.subarray(0, NONCE_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(this.associatedData(account));
    decipher.setAuthTag(stored.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
    const plaintext = Buffer.concat([decipher.update(stored.subarray(NONCE_BYTES + TAG_BYTES)), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as string;
  }

  private async readDataKey(): Promise<Buffer | null> {
    const encoded = await this.readKeychain(DATA_KEY);
    if (encoded === null) return null;
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) throw new Error('Invalid Keychain data key');
    return key;
  }

  private async createDataKey(): Promise<Buffer> {
    const key = randomBytes(KEY_BYTES);
    const encoded = key.toString('base64');
    // `security -i` limits each input line. Only the short data key goes over stdin, never in argv.
    const { code } = await this.run(['-i'], `add-generic-password -s ${this.service} -a ${DATA_KEY} -w ${encoded}\n`);
    if (code !== 0) throw new Error('Keychain data key write failed');
    if (await this.readKeychain(DATA_KEY) !== encoded) {
      await this.deleteKeychain(DATA_KEY);
      throw new Error('Keychain data key write verification failed');
    }
    return key;
  }

  private async readKeychain(account: string): Promise<string | null> {
    const { code, stdout } = await this.run(['find-generic-password', '-s', this.service, '-a', account, '-w']);
    if (code === NOT_FOUND) return null;
    if (code !== 0) throw new Error('Keychain read failed');
    return stdout.trim();
  }

  private async deleteKeychain(account: string): Promise<void> {
    const { code } = await this.run(['delete-generic-password', '-s', this.service, '-a', account]);
    if (code !== 0 && code !== NOT_FOUND) throw new Error('Keychain delete failed');
  }
}

/** Names enter both filenames and an interactive command; allow only safe path segments/bare arguments. */
function safeName(name: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(name)) throw new Error('Invalid secret name');
  return name;
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
  return kind === 'keychain' ? new KeychainSecretStore({ dataDir }) : new FileSecretStore(join(dataDir, 'secrets.json'));
}

