/** Local text embeddings, in input order. Implementations reject when unavailable. */
export interface Embedder {
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export function cosine(left: ArrayLike<number>, right: ArrayLike<number>): number {
  if (left.length !== right.length) return 0;
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!;
    const b = right[i]!;
    dot += a * b;
    leftSquared += a ** 2;
    rightSquared += b ** 2;
  }
  return leftSquared && rightSquared ? dot / Math.sqrt(leftSquared * rightSquared) : 0;
}

export function quantize(vector: ArrayLike<number>): Int8Array<ArrayBuffer> | null {
  let squared = 0;
  for (let i = 0; i < vector.length; i++) squared += vector[i]! ** 2;
  if (!Number.isFinite(squared) || squared === 0) return null;
  const scale = 127 / Math.sqrt(squared);
  return Int8Array.from(vector, (value) => Math.round(value * scale));
}
