import type { Embedder } from './embedder';
import { EMBEDDING_DIMENSIONS, EMBED_MESSAGE, OFFSCREEN_PATH, type EmbeddingReply } from './messages';

const EMBEDDING_TIMEOUT_MS = 25_000;

let opening: Promise<void> | undefined;

function ensureOffscreen() {
  opening ??= (async () => {
    const documentUrls = [chrome.runtime.getURL(OFFSCREEN_PATH)];
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Run the local ONNX embedding model.',
      });
    }
  })().finally(() => { opening = undefined; });
  return opening;
}

const embedder: Embedder = {
  async embed(texts) {
    if (!texts.length) return [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Local Embedder timed out')), EMBEDDING_TIMEOUT_MS);
    });
    try {
      return await Promise.race([embedOffscreen(texts), timeout]);
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Shared by background tasks that need the local model. Loads on first use. */
export function getEmbedder(): Embedder {
  return embedder;
}

async function embedOffscreen(texts: readonly string[]) {
  await ensureOffscreen();
  const reply: EmbeddingReply | undefined = await chrome.runtime.sendMessage({ type: EMBED_MESSAGE, texts });
  if (!reply?.ok || reply.vectors.length !== texts.length ||
      reply.vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite))) {
    throw new Error('Local Embedder unavailable');
  }
  return reply.vectors.map((vector) => Float32Array.from(vector));
}
