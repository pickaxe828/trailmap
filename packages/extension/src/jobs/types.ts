import type { LlmProviderId } from '@trailmap/shared';
import type { RequestErrorCode } from '../companion/client';

export const JOB_PRIORITY = { readPage: 0, conceptResolution: 0, fieldNotes: 1, skimmedPage: 2, mergeVerdict: 3 } as const;
export type JobPriority = (typeof JOB_PRIORITY)[keyof typeof JOB_PRIORITY];

export type JobPayloads = {
  page_enrichment: { canonicalUrl: string; textHash: string; visitId: string; textRevision?: number };
  /** `endedAt` identifies the closure this job belongs to; `revision` lets a later ticket request a new pass. */
  expedition_wrap_up: { expeditionId: string; endedAt: number; revision: number };
  field_notes: { expeditionId: string; endedAt: number; revision: number };
  concept_resolution: { canonicalUrl: string; visitId: string; enrichedAt: number; textHash: string; textRevision?: number };
  merge_verdict: { pairs: { candidateId: string; existingId: string }[] };
  thread_match: { expeditionId: string; notesWrittenAt?: number; myNotesAt?: number };
  living_note: { threadId: string; revision: number; checkpoint: number };
  /** `stamp` is when the notes last changed; the handler rebuilds its input from the current notes. */
  notes_enrichment: { expeditionId: string; stamp: number };
};

export type JobKind = keyof JobPayloads;
export type ModelJobKind = Exclude<JobKind, 'concept_resolution' | 'thread_match'>;
export const MODEL_JOB_KINDS = ['page_enrichment', 'expedition_wrap_up', 'field_notes', 'merge_verdict', 'living_note', 'notes_enrichment'] as const satisfies readonly ModelJobKind[];
export function isModelJob(kind: unknown): kind is ModelJobKind {
  return MODEL_JOB_KINDS.some((modelKind) => modelKind === kind);
}
export const RETRY_MODEL_JOBS = 'trailmap.retryModelJobs';

export type ModelHealth = {
  id: 'jobs';
  code: RequestErrorCode;
  recent: number[];
  attention?: { code: RequestErrorCode; provider: LlmProviderId };
};
export type JobSpec<K extends JobKind = JobKind> = {
  kind: K;
  key: string;
  priority: JobPriority;
  payload: JobPayloads[K];
  /** Wait this long before the job is first due (debounce). Not stored. */
  delayMs?: number;
};

export type Job<K extends JobKind = JobKind> = JobSpec<K> & {
  id: string;
  createdAt: number;
  status: 'pending' | 'leased' | 'done' | 'failed';
  availableAt: number;
  failures: number;
  lastError?: { code: RequestErrorCode; at: number; attempts: number };
  lease?: { token: string; until: number };
};

export function canRetryModelJob(job: Job, hold: QueueHold | undefined, now: number) {
  if (hold && hold.reason !== 'usage_limit_exceeded') return false;
  return job.status === 'failed' || (job.status === 'pending' && (!!job.lastError || job.failures > 0) &&
    (job.availableAt > now || (hold?.reason === 'usage_limit_exceeded' && hold.retryAt > now)));
}

export type QueueHold = {
  id: 'ai';
} & (
  | { reason: 'usage_limit_exceeded'; retryAt: number; probes: number }
  | { reason: 'not_eligible' | 'not_signed_in' | 'plan_usage_not_granted' }
);
