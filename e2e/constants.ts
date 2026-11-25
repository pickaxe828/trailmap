import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Port of the fixture site. Fixed so tests can build URLs without discovery. */
export const FIXTURE_PORT = 4173;

/** Fake hostnames the fixture site answers to (any `*.test` name works). */
export const FAKE_HOSTS = { learn: 'learn.test', blog: 'blog.test' } as const;

/** Where `bun run build` puts the unpacked extension. */
export const EXTENSION_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'packages', 'extension', '.output', 'chrome-mv3');
