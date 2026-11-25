import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSecretStore, KeychainSecretStore, createSecretStore, type SecretStore } from './secrets';

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
  /** An in-memory stand-in that speaks just enough of `security` and records how it was called. */
  function fakeSecurity() {
    const items = new Map<string, string>();
    const calls: Array<{ args: string[]; stdin?: string }> = [];
    const run = async (args: string[], stdin?: string) => {
      calls.push({ args, stdin });
      const key = (a: string[], s: string) => `${a[a.indexOf(s) + 1]}/${a[a.indexOf('-a') + 1]}`;
      if (args[0] === '-i') {
        const words = stdin!.trim().split(' ');
        items.set(`${words[words.indexOf('-s') + 1]}/${words[words.indexOf('-a') + 1]}`, words[words.indexOf('-w') + 1]!);
        return { code: 0, stdout: '' };
      }
      if (args[0] === 'find-generic-password') {
        const v = items.get(key(args, '-s'));
        return v === undefined ? { code: 44, stdout: '' } : { code: 0, stdout: `${v}\n` };
      }
      if (args[0] === 'delete-generic-password') {
        return items.delete(key(args, '-s')) ? { code: 0, stdout: '' } : { code: 44, stdout: '' };
      }
      throw new Error(`unexpected ${args.join(' ')}`);
    };
    return { run, calls };
  }

  behavesLikeASecretStore(() => new KeychainSecretStore({ service: 'svc', run: fakeSecurity().run }));

  test('never puts the secret on a command line (it goes over stdin)', async () => {
    const security = fakeSecurity();
    await new KeychainSecretStore({ service: 'svc', run: security.run }).set('k', 'sk-very-secret');
    expect(security.calls.flatMap((c) => c.args).join(' ')).not.toContain('sk-very-secret');
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
  const service = `com.trailmap.companion.test-${process.pid}`;
  const store = () => new KeychainSecretStore({ service });
  afterEach(async () => {
    await store().delete('probe');
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
