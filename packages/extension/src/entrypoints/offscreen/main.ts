import { serveReadPdfRequests, usePdfWorker } from '../../capture/pdf-runtime';
import workerUrl from '../../capture/pdf-worker-url';
import { serveEmbeddingRequests } from '../../embeddings/messages';
import { miniLm } from '../../embeddings/minilm';

serveEmbeddingRequests(miniLm);
usePdfWorker(workerUrl);
serveReadPdfRequests();
