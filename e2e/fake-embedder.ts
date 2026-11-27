import type { Embedder } from '../packages/extension/src/embeddings/embedder';
import { EMBEDDING_DIMENSIONS, serveEmbeddingRequests } from '../packages/extension/src/embeddings/messages';

const embedder: Embedder = {
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Float32Array(EMBEDDING_DIMENSIONS);
      const topic = /crdt|replication/i.test(text) ? 'crdt' : text;
      const hash = [...topic].reduce((value, char) => (31 * value + char.charCodeAt(0)) >>> 0, 0);
      vector[hash % EMBEDDING_DIMENSIONS] = 1;
      // Same field, different wording: about 0.7 apart, in the suggestion band but nowhere near an automatic join.
      if (/muscle|epaxial/i.test(text)) { vector.fill(0); vector[0] = 1; if (/epaxial/i.test(text)) vector[1] = 1; }
      return vector;
    });
  },
};

serveEmbeddingRequests(embedder);
