import { dlopen, FFIType } from 'bun:ffi';
import { closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

const LOCK_EX_NONBLOCKING = 2 | 4;
const WAIT_LIMIT_MS = 45_000;
const RETRY_MS = 25;

let flock: ((fd: number, operation: number) => number) | undefined;

/** POSIX advisory lock. Never unlink the lock file: all hosts must lock the same inode. */
export async function withFileLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  if (!flock) {
    const libc = process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';
    flock = dlopen(libc, { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } }).symbols.flock;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const deadline = performance.now() + WAIT_LIMIT_MS;
    while (flock(fd, LOCK_EX_NONBLOCKING) !== 0) {
      if (performance.now() >= deadline) throw new Error('Companion lock unavailable');
      await Bun.sleep(RETRY_MS);
    }
    return await work();
  } finally {
    // The OS also releases the lock if the host exits during a request.
    closeSync(fd);
  }
}
