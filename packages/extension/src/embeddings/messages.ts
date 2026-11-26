import type { Embedder } from './embedder';

export const EMBED_MESSAGE = 'trailmap.embed';
export const OFFSCREEN_PATH = 'offscreen.html';
export const EMBEDDING_DIMENSIONS = 384;

export type EmbeddingReply =
  | { ok: true; vectors: number[][] }
  | { ok: false; error: 'model-download' | 'unavailable' };

export class ModelDownloadError extends Error {}

export function serveEmbeddingRequests(embedder: Embedder) {
  chrome.runtime.onMessage.addListener((message, sender, respond: (reply: EmbeddingReply) => void) => {
    if (message?.type !== EMBED_MESSAGE || sender.id !== chrome.runtime.id || sender.tab ||
        sender.url !== chrome.runtime.getURL('background.js')) return;
    const texts: unknown = message.texts;
    if (!Array.isArray(texts) || !texts.every((text) => typeof text === 'string')) return;

    void embedder.embed(texts).then(
      (vectors) => respond({ ok: true, vectors: vectors.map((vector) => Array.from(vector)) }),
      (error: unknown) => respond({ ok: false, error: error instanceof ModelDownloadError ? 'model-download' : 'unavailable' }),
    );
    return true;
  });
}
