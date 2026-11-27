import type { Embedder } from './embedder';
import { isFirefox } from '../platform/browser';
import { embedOnPlatform } from '../platform/embeddings';
import { LOCAL_EMBEDDINGS_UNAVAILABLE } from './messages';

const EMBEDDING_TIMEOUT_MS = 25_000;

const embedder: Embedder = {
  async embed(texts) {
    if (!texts.length) return [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Local Embedder timed out')), EMBEDDING_TIMEOUT_MS);
    });
    function report(unavailable: boolean) {
      if (isFirefox) void chrome.storage.session.set({ [LOCAL_EMBEDDINGS_UNAVAILABLE]: unavailable }).catch(() => {});
    }
    try {
      const vectors = await Promise.race([embedOnPlatform(texts), timeout]);
      report(false);
      return vectors;
    } catch (error) {
      report(true);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Shared by background tasks that need the local model. Loads on first use. */
export function getEmbedder(): Embedder {
  return embedder;
}
