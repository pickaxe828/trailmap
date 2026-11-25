import { expect, test } from 'bun:test';
import { EXTENSION_ID, EXTENSION_PUBLIC_KEY, extensionIdFromPublicKey } from '../extension-key';

test('extension ID is derived from the committed public key (Chrome algorithm)', async () => {
  expect(await extensionIdFromPublicKey(EXTENSION_PUBLIC_KEY)).toBe(EXTENSION_ID);
});

test('extension ID matches the documented value', () => {
  // Also documented in AGENTS.md and used by the companion's allowed_origins later.
  expect(EXTENSION_ID).toBe('boahmdajmiicaicaopfgkcdaahidmalm');
});
