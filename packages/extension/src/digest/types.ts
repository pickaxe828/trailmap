import type { ModelSources } from '@trailmap/shared';

/**
 * A stored weekly digest. It keeps only the model's own words (`summary`, each `why`) and ids: titles, links, loose ends and
 * concept strength are read live, so nothing that was forgotten lingers in a copy. `sources` and `expeditionIds` say what the
 * words were written from, which is how Forget finds a digest to remove.
 */
export type Digest = {
  /** `week-YYYY-MM-DD` (the Monday that starts the week) or `recent-YYYY-MM-DD` (an on-demand digest of the last 7 days). */
  id: string;
  kind: 'week' | 'recent';
  from: number;
  to: number;
  generatedAt: number;
  summary: string;
  expeditions: { id: string; why: string }[];
  threads: { id: string; why: string }[];
  conceptIds: string[];
  /** Dormant threads when the digest was written, most recently active first. Titles are read live. */
  pickingUp: string[];
  sources: ModelSources;
  expeditionIds: string[];
};
