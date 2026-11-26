import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeSecurity } from './fake-security';
import { FileSecretStore, KeychainSecretStore, createSecretStore, type SecurityRunner, type SecretStore } from './secrets';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailmap-secrets-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The behaviour every SecretStore must have, whatever backs it. */
function behavesLikeASecretStore(make: () => SecretStore) {
  test('returns null for a secret that was never set', async () => {
    expect(await make().get('anthropic-key')).toBeNull();
  });

  test('stores, overwrites and deletes secrets, including non-ASCII ones', async () => {
    const store = make();
    await store.set('anthropic-key', 'sk-one');
    expect(await store.get('anthropic-key')).toBe('sk-one');
    await store.set('anthropic-key', 'sk-two é😀 "quoted"');
    expect(await store.get('anthropic-key')).toBe('sk-two é😀 "quoted"');
    await store.delete('anthropic-key');
    expect(await store.get('anthropic-key')).toBeNull();
    await store.delete('anthropic-key'); // deleting nothing is fine
  });

  test('keeps accounts separate', async () => {
    const store = make();
    await store.set('a', '1');
    await store.set('b', '2');
    expect([await store.get('a'), await store.get('b')]).toEqual(['1', '2']);
  });
}

describe('file store', () => {
  const file = () => join(dir, 'nested', 'secrets.json');
  behavesLikeASecretStore(() => new FileSecretStore(file()));

  test('writes the file readable by its owner only (0600) and persists across instances', async () => {
    await new FileSecretStore(file()).set('k', 'v');
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700);
    expect(await new FileSecretStore(file()).get('k')).toBe('v');
  });

  test('tightens a file that was created with looser permissions', async () => {
    const path = join(dir, 'loose.json');
    writeFileSync(path, '{}', { mode: 0o644 });
    await new FileSecretStore(path).set('k', 'v');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('keychain store (fake security CLI)', () => {
  const make = (run: SecurityRunner) => new KeychainSecretStore({ service: 'svc', run, dataDir: dir });
  behavesLikeASecretStore(() => make(fakeSecurity().run));

  test('keeps differently cased account names separate on case-insensitive filesystems', async () => {
    const { run } = fakeSecurity();
    const store = make(run);
    await store.set('probe', 'lower');
    await store.set('Probe', 'upper');
    expect([await store.get('probe'), await store.get('Probe')]).toEqual(['lower', 'upper']);
  });

  test('puts only a short key on stdin and keeps large secret values in authenticated private files', async () => {
    const security = fakeSecurity();
    const store = make(security.run);
    const value = 'example-token'.repeat(800);
    await store.set('k', value);
    expect(await make(security.run).get('k')).toBe(value);
    const [key] = [...security.items.values()];
    expect(security.items.size).toBe(1);
    expect(Buffer.from(key!, 'base64')).toHaveLength(32);
    expect(security.calls.flatMap((c) => c.args).join(' ')).not.toContain(key!);
    const cliInput = security.calls.map((c) => [...c.args, c.stdin].join(' ')).join('\n');
    expect(cliInput).not.toContain('example-token');
    expect(cliInput).not.toContain(Buffer.from(value).toString('base64'));
    const [entry] = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((entry) => statSync(join(dir, entry)).isFile());
    const path = join(dir, entry!);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const ciphertext = readFileSync(path);
    expect(ciphertext.includes('example-token')).toBe(false);
    ciphertext[ciphertext.length - 1] = ciphertext.at(-1)! ^ 1;
    writeFileSync(path, ciphertext);
    await expect(store.get('k')).rejects.toThrow();
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
  });

  test('does not trust a successful security exit when its write was truncated', async () => {
    const security = fakeSecurity({ lineLimit: 75 });
    const store = make(security.run);
    await expect(store.set('k', 'example-token')).rejects.toThrow('Keychain data key write verification failed');
    expect(await store.get('k')).toBeNull();
  });

  test('throws a clear error if the encrypted secret cannot be verified after writing', async () => {
    const security = fakeSecurity();
    await make(security.run).set('another-account', 'existing'); // Initialise the data key.
    let reads = 0;
    const store = make(async (args, stdin) => {
      if (args[0] === 'find-generic-password' && ++reads === 2) {
        // Simulate a wrong (but well-formed) Keychain value on the readback.
        return { code: 0, stdout: Buffer.alloc(32).toString('base64') };
      }
      return security.run(args, stdin);
    });
    await expect(store.set('k', 'example-token')).rejects.toThrow('Encrypted secret write verification failed');
  });

  test('reads legacy short Keychain items and does not resurrect them after updating or deleting', async () => {
    const security = fakeSecurity();
    security.items.set('svc/chatgpt.host-id', Buffer.from('urn:uuid:test').toString('base64'));
    security.items.set('svc/anthropic.api-key', Buffer.from('sk-legacy').toString('base64'));
    const store = make(security.run);
    expect(await store.get('chatgpt.host-id')).toBe('urn:uuid:test');
    expect(await store.get('anthropic.api-key')).toBe('sk-legacy');
    await store.set('anthropic.api-key', 'sk-new');
    expect(await store.get('anthropic.api-key')).toBe('sk-new');
    expect(security.items.has('svc/anthropic.api-key')).toBe(false);
    await store.delete('chatgpt.host-id');
    expect(await store.get('chatgpt.host-id')).toBeNull();
  });
});

describe('createSecretStore', () => {
  test('uses the Keychain on macOS and a file elsewhere, unless the environment says otherwise', () => {
    const base = { dataDir: dir };
    expect(createSecretStore({ ...base, platform: 'darwin', env: {} })).toBeInstanceOf(KeychainSecretStore);
    expect(createSecretStore({ ...base, platform: 'linux', env: {} })).toBeInstanceOf(FileSecretStore);
    expect(createSecretStore({ ...base, platform: 'darwin', env: { TRAILMAP_SECRET_STORE: 'file' } })).toBeInstanceOf(FileSecretStore);
    expect(createSecretStore({ ...base, platform: 'linux', env: { TRAILMAP_SECRET_STORE: 'keychain' } })).toBeInstanceOf(KeychainSecretStore);
  });
});

// The real macOS Keychain, through the real `security` CLI. Uses a throwaway service name and cleans up after itself.
describe.skipIf(process.platform !== 'darwin')('keychain store (real macOS Keychain)', () => {
  let service: string;
  beforeEach(() => { service = `com.trailmap.companion.test-${crypto.randomUUID()}`; });
  const store = () => new KeychainSecretStore({ service, dataDir: dir });
  afterEach(async () => {
    for (const account of ['probe', 'trailmap.data-key']) {
      const proc = Bun.spawn(['security', 'delete-generic-password', '-s', service, '-a', account], {
        stdout: 'ignore', stderr: 'ignore',
      });
      expect([0, 44]).toContain(await proc.exited);
    }
  });

  test('round-trips an 8 KB secret through the real Keychain', async () => {
    const value = 'x'.repeat(8192);
    await store().set('probe', value);
    expect((await store().get('probe'))?.length).toBe(value.length);
    expect(await store().get('probe')).toBe(value);
  });

  test('round-trips a secret', async () => {
    expect(await store().get('probe')).toBeNull();
    await store().set('probe', 'sk-keychain-é "q" \\ end');
    expect(await store().get('probe')).toBe('sk-keychain-é "q" \\ end');
    await store().set('probe', 'replaced');
    expect(await store().get('probe')).toBe('replaced');
    await store().delete('probe');
    expect(await store().get('probe')).toBeNull();
  });
});
