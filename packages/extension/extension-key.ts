/**
 * The extension's fixed identity. Only the PUBLIC key is committed; the private
 * key lives outside the repo (see AGENTS.md) and is only needed to pack a .crx.
 *
 * The `key` manifest field makes Chrome derive the same extension ID on every
 * machine and every build, which the companion's Native Messaging manifest
 * (`allowed_origins`) depends on.
 */
export const EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAue88yEV10uxorJCkPjgmCNZWilWHftptv4wBZhH+0ujh3fKbnj4d/vYzoadf4c9ZgUTeQMxvpK9G9Y4LJiW5DrAI0nl0zfJUbVBCeeMU3t1kGuR1nzThKL0xazJF+677kI8Nu+zAQBcvSd6qbbhctVyH06RVbC4TdrYEkoCcxSZLLCzuCe4hLXwd01+B6gIyqGsiJcbWDGWjIS8pbueRnnpxlxVcvIyl9tXYf6zj0vVPUG4xOIK55JjHVH0UFvSfzO0Q25hJkiEgUVpvqtYZ74PXiX4UE1dII1AL6wCG4wVdivw7cUpR6N7/Ek2VpBh4QKLDyBh5pCtTceb9ddUX1wIDAQAB';

/** Derived from EXTENSION_PUBLIC_KEY; guarded by a unit test. */
export const EXTENSION_ID = 'boahmdajmiicaicaopfgkcdaahidmalm';

/** Chrome's algorithm: first 16 bytes of SHA-256(DER public key), hex digits mapped 0-9a-f -> a-p. */
export async function extensionIdFromPublicKey(base64Der: string): Promise<string> {
  const der = Uint8Array.from(atob(base64Der), (c) => c.charCodeAt(0));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
  return Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[Number.parseInt(c, 16)]!);
}
