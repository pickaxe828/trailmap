import type { Page } from '@trailmap/shared';

export function newPage(canonicalUrl: string, text = '', textHash = '', sourceHash?: string): Page {
  return {
    canonicalUrl,
    text,
    textHash,
    sourceHash,
    summary: null,
    takeaways: [],
    embedding: null,
    pageKind: null,
    enrichedAt: null,
  };
}
