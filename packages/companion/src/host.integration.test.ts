/** Spawns the real companion process (host mode) and talks to it over stdio, as the browser does. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXTENSION_ID } from '../../extension/extension-key';
import { FrameDecoder, encodeFrame } from './framing';
import { runHost } from './host';
import { FileSecretStore } from './secrets';

const MAIN = new URL('./main.ts', import.meta.url).pathname;
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;

let child: ReturnType<typeof Bun.spawn> | undefined;
let temp: string;
beforeEach(() => { temp = mkdtempSync(join(tmpdir(), 'trailmap-host-')); });
afterEach(async () => {
  child?.kill();
  await child?.exited;
  child = undefined;
  rmSync(temp, { recursive: true, force: true });
});

function startHost(args: string[] = [ORIGIN], env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', MAIN, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    env: { ...process.env, TRAILMAP_COMPANION_DATA_DIR: join(temp, 'data'), TRAILMAP_SECRET_STORE: 'file', ...env },
  });
  child = proc;
  const decoder = new FrameDecoder();
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  void (async () => {
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      for (const json of decoder.push(chunk)) queue.push(JSON.parse(json));
      wake?.();
    }
    wake?.();
  })();
  return {
    proc,
    write: (bytes: Uint8Array) => {
      (proc.stdin as { write(b: Uint8Array): number; flush(): void }).write(bytes);
      (proc.stdin as { flush(): void }).flush();
    },
    async next(): Promise<unknown> {
      const deadline = Date.now() + 5000;
      while (queue.length === 0) {
        if (Date.now() > deadline) throw new Error('timed out waiting for a frame');
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 50);
        });
      }
      return queue.shift();
    },
  };
}

const textFrame = (text: string) => {
  const body = new TextEncoder().encode(text);
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, true);
  frame.set(body, 4);
  return frame;
};

test('the stdio host announces itself and answers hello', async () => {
  const host = startHost();
  expect(await host.next()).toMatchObject({ type: 'event', name: 'companion.ready' });
  host.write(encodeFrame({ type: 'companion.hello', id: 'h1' }));
  expect(await host.next()).toMatchObject({ type: 'companion.hello', id: 'h1', version: expect.any(String) });
});

test('the host reads a frame explicitly split across its header and body', async () => {
  const frame = encodeFrame({ type: 'companion.hello', id: 'split' });
  const reply = Promise.withResolvers<unknown>();
  const decoder = new FrameDecoder();
  let wroteReply = false;
  async function* input() {
    yield frame.subarray(0, 2);
    expect(wroteReply).toBe(false);
    yield frame.subarray(2, 9);
    expect(wroteReply).toBe(false);
    yield frame.subarray(9);
    await reply.promise;
  }
  const closed = runHost(input(), (bytes) => {
    for (const json of decoder.push(bytes)) {
      const message = JSON.parse(json);
      if (message.type !== 'event') { wroteReply = true; reply.resolve(message); }
    }
  }, { env: {}, secrets: new FileSecretStore(join(temp, 'secrets.json')), log: () => {} });
  expect(await reply.promise).toMatchObject({ type: 'companion.hello', id: 'split' });
  expect(await closed).toBe(true);
});

test('invalid messages get typed errors and the host keeps serving', async () => {
  const host = startHost();
  await host.next(); // ready

  host.write(textFrame('{nope'));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'invalid_json', id: null });

  host.write(encodeFrame({ type: 'fetch.url', id: 'x', url: 'https://example.com' }));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'unknown_message', id: 'x' });

  host.write(encodeFrame({ type: 'companion.hello', id: 99 }));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'invalid_message' });

  host.write(encodeFrame({ type: 'companion.hello', id: 'still-alive' }));
  expect(await host.next()).toMatchObject({ type: 'companion.hello', id: 'still-alive' });
});

test('the host exits cleanly when the browser closes its stdin', async () => {
  const host = startHost();
  await host.next();
  (host.proc.stdin as { end(): void }).end();
  expect(await host.proc.exited).toBe(0);
});

test('the Firefox launch arguments allow Trailmap to complete the handshake', async () => {
  const host = startHost(['/tmp/com.trailmap.companion.json', 'trailmap@pickaxe828']);
  expect(await host.next()).toMatchObject({ type: 'event', name: 'companion.ready' });
  host.write(encodeFrame({ type: 'companion.hello', id: 'gecko' }));
  expect(await host.next()).toMatchObject({ type: 'companion.hello', id: 'gecko', version: expect.any(String) });
});

test.each([
  ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],
  ['/tmp/com.trailmap.companion.json', 'other@example.org'],
  ['/tmp/com.trailmap.companion.json', 'other-id'],
  ['other@example.org', 'trailmap@pickaxe828'],
  ['trailmap@pickaxe828'],
  [],
])('the host refuses an unknown or missing caller (%p)', (...args) => {
  const proc = Bun.spawn(['bun', MAIN, ...args], {
    stdin: 'ignore', stdout: 'pipe', stderr: 'ignore',
    env: { ...process.env, TRAILMAP_COMPANION_DATA_DIR: temp, TRAILMAP_SECRET_STORE: 'file' },
  });
  return expect(proc.exited).resolves.toBe(2);
});

test('vault.write atomically replaces a note in the selected folder across host restarts', async () => {
  const vault = join(temp, 'vault');
  mkdirSync(vault);
  let host = startHost();
  await host.next();
  host.write(encodeFrame({ type: 'vault.setFolder', id: 'setup', path: vault }));
  const selection = await host.next() as { type: string; folder: { id: string; path: string } };
  expect(selection.type).toBe('vault.setFolder');
  const folderId = selection.folder.id;
  expect(folderId).toMatch(/^[a-f0-9]{64}$/);
  (host.proc.stdin as { end(): void }).end();
  expect(await host.proc.exited).toBe(0);

  host = startHost();
  await host.next();
  const note = join(vault, 'Expedition.md');
  for (const markdown of ['# First note\n', '# Edited note\n']) {
    host.write(encodeFrame({ type: 'vault.write', id: 'write', folderId, path: 'Expedition.md', markdown }));
    expect(await host.next()).toEqual({ type: 'vault.write', id: 'write' });
    expect(readFileSync(note, 'utf8')).toBe(markdown);
    expect(statSync(note).mode & 0o777).toBe(0o600);
    expect(readdirSync(vault)).toEqual(['Expedition.md']);
  }
});

test('vault.write rejects traversal, symlinks and a replaced vault directory', async () => {
  const vault = join(temp, 'vault');
  const outside = join(temp, 'outside');
  mkdirSync(vault);
  mkdirSync(outside);
  const protectedNote = join(outside, 'Protected.md');
  writeFileSync(protectedNote, 'keep');
  symlinkSync(protectedNote, join(vault, 'Link.md'));
  symlinkSync(join(outside, 'Missing.md'), join(vault, 'Dangling.md'));
  symlinkSync(outside, join(vault, 'Dir'));
  const host = startHost();
  await host.next();
  host.write(encodeFrame({ type: 'vault.setFolder', id: 'setup', path: vault }));
  const { folder } = await host.next() as { folder: { id: string } };
  for (const path of [protectedNote, '../outside/Protected.md', 'Link.md', 'Dangling.md', 'Dir/Protected.md']) {
    host.write(encodeFrame({ type: 'vault.write', id: 'escape', folderId: folder.id, path, markdown: 'replace' }));
    expect(await host.next()).toMatchObject({ type: 'error', code: 'vault_unsafe_path' });
  }
  renameSync(vault, join(temp, 'moved'));
  symlinkSync(outside, vault);
  host.write(encodeFrame({ type: 'vault.write', id: 'symlink', folderId: folder.id, path: 'Protected.md', markdown: 'replace' }));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'vault_unavailable' });
  rmSync(vault);
  mkdirSync(vault);
  host.write(encodeFrame({ type: 'vault.write', id: 'replacement', folderId: folder.id, path: 'Protected.md', markdown: 'replace' }));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'vault_unavailable' });
  expect(readdirSync(vault)).toEqual([]);
  expect(readdirSync(outside)).toEqual(['Protected.md']);
  expect(readFileSync(protectedNote, 'utf8')).toBe('keep');
});

test('vault.remove prunes an unchanged generated note but keeps a manually edited copy', async () => {
  const vault = join(temp, 'vault');
  mkdirSync(vault);
  const path = `trailmap-concept-${'a'.repeat(64)}.md`;
  const note = join(vault, path);
  const markdown = '# Concept\n';
  const sha256 = createHash('sha256').update(markdown).digest('hex');
  const host = startHost();
  await host.next();
  host.write(encodeFrame({ type: 'vault.setFolder', id: 'setup', path: vault }));
  const { folder } = await host.next() as { folder: { id: string } };
  const remove = () => host.write(encodeFrame({ type: 'vault.remove', id: 'remove', folderId: folder.id, path, sha256 }));

  writeFileSync(note, '# Manually edited');
  remove();
  expect(await host.next()).toEqual({ type: 'vault.remove', id: 'remove' });
  expect(readFileSync(note, 'utf8')).toBe('# Manually edited');

  writeFileSync(note, markdown);
  remove();
  expect(await host.next()).toEqual({ type: 'vault.remove', id: 'remove' });
  expect(existsSync(note)).toBe(false);

  const outside = join(temp, 'outside.md');
  writeFileSync(outside, markdown);
  symlinkSync(outside, note);
  remove();
  expect(await host.next()).toMatchObject({ type: 'error', code: 'vault_unsafe_path' });
  expect(readFileSync(outside, 'utf8')).toBe(markdown);
});
