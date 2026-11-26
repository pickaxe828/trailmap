import type { JobHandlers } from './queue';

const discard = async () => 'discard' as const;
export const discardJobs: JobHandlers = {
  page_enrichment: discard, expedition_wrap_up: discard, field_notes: discard, concept_resolution: discard,
  merge_verdict: discard, thread_match: discard, living_note: discard,
};
