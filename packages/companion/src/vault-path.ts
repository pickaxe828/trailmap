import { Buffer } from 'node:buffer';

/** Vault files are deliberately flat. No path sent by the extension can name an ancestor directory. */
export function vaultFilename(path: string): string {
  if (!/^[^./\\:\x00-\x1f][^/\\:\x00-\x1f]*\.md$/u.test(path) || Buffer.byteLength(path) > 255 || /[\r\n]$/u.test(path)) {
    throw new Error('Use a single relative Markdown filename.');
  }
  return path;
}
