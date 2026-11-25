export const JOB_PRIORITY = { readPage: 0, conceptResolution: 0, fieldNotes: 1, skimmedPage: 2, mergeVerdict: 3 } as const;
export type JobPriority = (typeof JOB_PRIORITY)[keyof typeof JOB_PRIORITY];

export type JobPayloads = {
  page_enrichment: { canonicalUrl: string; textHash: string; visitId: string; textRevision?: number };
  concept_resolution: { canonicalUrl: string; visitId: string; enrichedAt: number; textHash: string; textRevision?: number };
  merge_verdict: { pairs: { candidateId: string; existingId: string }[] };
};

export type JobKind = keyof JobPayloads;
export type JobSpec<K extends JobKind = JobKind> = {
  kind: K;
  key: string;
  priority: JobPriority;
  payload: JobPayloads[K];
};

export type Job<K extends JobKind = JobKind> = JobSpec<K> & {
  id: string;
  createdAt: number;
  status: 'pending' | 'leased' | 'done' | 'failed';
  availableAt: number;
  failures: number;
  lease?: { token: string; until: number };
};

export type QueueHold = {
  id: 'ai';
} & (
  | { reason: 'usage_limit_exceeded'; retryAt: number; probes: number }
  | { reason: 'not_eligible' | 'not_signed_in' | 'plan_usage_not_granted' }
);
