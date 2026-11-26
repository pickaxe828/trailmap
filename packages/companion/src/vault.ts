import { dlopen, suffix } from 'bun:ffi';
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync, closeSync, constants as flags, fstatSync, fsyncSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { VaultFolder } from '@trailmap/shared';
import { vaultFilename } from './vault-path';

export class VaultError extends Error {
  constructor(readonly code: 'vault_invalid_folder' | 'vault_unsafe_path' | 'vault_unavailable', message: string) {
    super(message);
  }
}

const unavailable = () => new VaultError('vault_unavailable', 'The vault is unavailable. Check its permissions or select it again.');
const unsafePath = () => new VaultError('vault_unsafe_path', 'Use a relative Markdown filename that is not a symlink.');
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const cString = (value: string) => Buffer.from(`${value}\0`);

// Work relative to a verified directory descriptor, never a checked-then-used
// absolute path. Node's fs API does not expose these POSIX calls.
function openLibc() {
  const path = suffix === 'dylib' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';
  return dlopen(path, {
    openat: { args: ['i32', 'ptr', 'i32', 'i32', 'i64', 'i64', 'i64', 'i64', 'i64'], returns: 'i32' },
    readlinkat: { args: ['i32', 'ptr', 'ptr', 'usize'], returns: 'i64' },
    renameat: { args: ['i32', 'ptr', 'i32', 'ptr'], returns: 'i32' },
    unlinkat: { args: ['i32', 'ptr', 'i32'], returns: 'i32' },
  });
}
let libc: ReturnType<typeof openLibc> | undefined;

function openAt(api: ReturnType<typeof openLibc>['symbols'], dir: number, name: Buffer, flags: number, mode = 0) {
  // openat's mode is variadic. Darwin arm64 reads it from the stack rather
  // than the fourth integer register. Supply both ABI locations.
  return api.openat(dir, name, flags, mode, 0n, 0n, 0n, 0n, BigInt(mode));
}

function folderId(path: string, fd: number) {
  const { dev, ino } = fstatSync(fd, { bigint: true });
  return digest(JSON.stringify([path, String(dev), String(ino)]));
}

async function pickFolder(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const result = Bun.spawn(['/usr/bin/osascript', '-e',
      'with timeout of 120 seconds\nreturn POSIX path of (choose folder with prompt "Choose your Obsidian vault folder")\nend timeout',
    ], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 125_000 });
    const [code, path, error] = await Promise.all([result.exited, new Response(result.stdout).text(), new Response(result.stderr).text()]);
    if (code === 0) return path.replace(/\n$/, '');
    if (error.trimEnd().endsWith('(-128)')) return null; // User cancelled.
  }
  throw new VaultError('vault_invalid_folder', 'The folder picker is unavailable. Enter the full folder path instead.');
}

export class Vault {
  private readonly config: string;

  constructor(private readonly dataDir: string) {
    this.config = join(dataDir, 'vault.json');
  }

  async setFolder(path?: string | null): Promise<{ folder: VaultFolder | null; cancelled?: true }> {
    if (path === undefined) {
      const chosen = await pickFolder();
      if (chosen === null) return { folder: null, cancelled: true };
      path = chosen;
    }
    if (path === null) {
      rmSync(this.config, { force: true });
      return { folder: null };
    }
    let folder: VaultFolder;
    try {
      if (!isAbsolute(path) || path.includes('\0')) throw unavailable();
      const canonical = realpathSync(path);
      const fd = openSync(canonical, flags.O_DIRECTORY | flags.O_NOFOLLOW | flags.O_RDONLY);
      try {
        accessSync(canonical, flags.W_OK | flags.X_OK);
        folder = { id: folderId(canonical, fd), path: canonical };
      } finally {
        closeSync(fd);
      }
    } catch {
      throw new VaultError('vault_invalid_folder', 'Enter the full path to an existing, writable folder.');
    }

    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = join(this.dataDir, `.vault-${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, JSON.stringify(folder), { flag: 'wx', mode: 0o600 });
      renameSync(temp, this.config);
    } finally {
      rmSync(temp, { force: true });
    }
    return { folder };
  }

  write(id: string, path: string, markdown: string): void {
    this.withFilename(id, path, (directory, name, api) => {
      const temp = cString(`.trailmap-${randomUUID()}.tmp`);
      const fd = openAt(api, directory, temp, flags.O_CREAT | flags.O_EXCL | flags.O_NOFOLLOW | flags.O_WRONLY, 0o600);
      if (fd < 0) throw unavailable();
      try {
        try {
          writeFileSync(fd, markdown);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        if (api.renameat(directory, temp, directory, name) !== 0) throw unavailable();
      } finally {
        api.unlinkat(directory, temp, 0);
      }
    });
  }

  /** A stale generated note may be removed only if it still matches the last synced bytes. */
  remove(id: string, path: string, sha256: string): void {
    if (!/^trailmap-[a-z]+-[a-f0-9]{64}\.md$/.test(path)) throw unsafePath();
    this.withFilename(id, path, (directory, name, api) => {
      const fd = openAt(api, directory, name, flags.O_NOFOLLOW | flags.O_RDONLY | flags.O_NONBLOCK);
      if (fd < 0) return;
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || digest(readFileSync(fd)) !== sha256) return;
        if (api.unlinkat(directory, name, 0) !== 0) throw unavailable();
      } finally {
        closeSync(fd);
      }
    });
  }

  private withFilename<T>(id: string, path: string, use: (
    directory: number, name: Buffer, api: ReturnType<typeof openLibc>['symbols'],
  ) => T): T {
    let name: Buffer;
    try {
      name = cString(vaultFilename(path));
    } catch {
      throw unsafePath();
    }
    try {
      const folder = VaultFolder.parse(JSON.parse(readFileSync(this.config, 'utf8')));
      if (folder.id !== id) throw unavailable();
      const directory = openSync(folder.path, flags.O_DIRECTORY | flags.O_NOFOLLOW | flags.O_RDONLY);
      try {
        if (folderId(folder.path, directory) !== id) throw unavailable();
        const api = (libc ??= openLibc()).symbols;
        if (api.readlinkat(directory, name, Buffer.alloc(1), 1n) >= 0n) throw unsafePath();
        return use(directory, name, api);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      throw error instanceof VaultError ? error : unavailable();
    }
  }
}
