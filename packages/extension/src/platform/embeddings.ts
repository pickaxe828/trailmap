import { EMBEDDING_DIMENSIONS, EMBED_MESSAGE, OFFSCREEN_PATH, type EmbeddingReply } from '../embeddings/messages';
import { isFirefox } from './browser';

let opening: Promise<void> | undefined;

/** The one offscreen document hosts both the local embedder and the PDF text reader. */
export function ensureOffscreen() {
  opening ??= (async () => {
    const documentUrls = [chrome.runtime.getURL(OFFSCREEN_PATH)];
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Run the local ONNX embedding model and read PDF text with pdf.js.',
      });
    }
  })().finally(() => { opening = undefined; });
  return opening;
}

export async function embedOnPlatform(texts: readonly string[]): Promise<Float32Array[]> {
  // Firefox MV3 runs in a document, not a service worker. Lazy import only on demand.
  if (isFirefox) return (await import('../embeddings/minilm')).miniLm.embed(texts);
  await ensureOffscreen();
  const reply: EmbeddingReply | undefined = await chrome.runtime.sendMessage({ type: EMBED_MESSAGE, texts });
  if (!reply?.ok || reply.vectors.length !== texts.length ||
      reply.vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite))) {
    throw new Error('Local Embedder unavailable');
  }
  return reply.vectors.map((vector) => Float32Array.from(vector));
}
