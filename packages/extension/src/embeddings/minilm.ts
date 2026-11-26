import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import ortWasmUrl from '../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import type { Embedder } from './embedder';
import { EMBEDDING_DIMENSIONS, ModelDownloadError } from './messages';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const ort = env.backends.onnx.wasm!;
ort.wasmPaths = { wasm: new URL(ortWasmUrl, location.origin).href };
ort.numThreads = 1;
env.allowLocalModels = false;
env.useBrowserCache = true;

let extractor: Promise<FeatureExtractionPipeline> | undefined;

function loadModel() {
  extractor ??= pipeline('feature-extraction', MODEL, { dtype: 'q8', device: 'wasm' }).catch((error: unknown) => {
    extractor = undefined;
    if (error instanceof Error && (error.message === 'Failed to fetch' ||
        error.message.includes(`occurred while trying to load file: "https://huggingface.co/${MODEL}/`))) {
      throw new ModelDownloadError('MiniLM model files could not be downloaded');
    }
    throw error;
  });
  return extractor;
}

export const miniLm: Embedder = {
  async embed(texts) {
    if (!texts.length) return [];
    const extract = await loadModel();
    const output = await extract([...texts], { pooling: 'mean', normalize: true });
    const data = output.data as Float32Array;
    return texts.map((_, i) => data.slice(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS));
  },
};
