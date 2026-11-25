import { serveEmbeddingRequests } from '../../embeddings/messages';
import { miniLm } from '../../embeddings/minilm';

serveEmbeddingRequests(miniLm);
