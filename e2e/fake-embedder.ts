import type { Embedder } from '../packages/extension/src/embeddings/embedder';
import { EMBEDDING_DIMENSIONS, serveEmbeddingRequests } from '../packages/extension/src/embeddings/messages';

const embedder: Embedder = {
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Float32Array(EMBEDDING_DIMENSIONS);
      const topic = /crdt|replication/i.test(text) ? 'crdt' : text;
      const hash = [...topic].reduce((value, char) => (31 * value + char.charCodeAt(0)) >>> 0, 0);
      vector[hash % EMBEDDING_DIMENSIONS] = 1;
      return vector;
    });
  },
};

serveEmbeddingRequests(embedder);
