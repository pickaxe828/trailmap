import type { Table } from 'dexie';
import { CompanionRequestError } from '../companion/client';
import type { TrailmapDb } from '../db/db';
import type { Job, JobKind, JobSpec, QueueHold } from './types';

export { JOB_PRIORITY, type JobPriority } from './types';

// Longer than the companion's bounded inference and Native Messaging deadlines.
export const JOB_LEASE_MS = 4 * 60_000;
const FIRST_LIMIT_PROBE_MS = 30 * 60_000;
const MAX_LIMIT_PROBE_MS = 6 * 60 * 60_000;
const TRANSIENT_MAX_MS = 15 * 60_000;

export type JobResult = void | { retryAt: number } | 'discard' | { commit: () => Promise<void> };
export type JobHandlers = { [K in JobKind]: (job: Job<K>) => Promise<JobResult> };

type JobChange = { job: Partial<Job>; hold?: QueueHold };
type Attempt = { result: JobResult } | { error: unknown };

export const jobId = (kind: JobKind, key: string) => JSON.stringify([kind, key]);

/** A caller can include db.jobs in its domain transaction so the trigger and job commit together. */
export async function enqueueJob<K extends JobKind>(db: TrailmapDb, spec: JobSpec<K>, now: number): Promise<void> {
  await db.transaction('rw', db.jobs, async () => {
    const id = jobId(spec.kind, spec.key);
    const existing = await db.jobs.get(id);
    if (!existing) {
      await db.jobs.add({ ...spec, id, createdAt: now, status: 'pending', availableAt: now, failures: 0 });
    } else if (existing.status === 'pending' && spec.priority < existing.priority) {
      await db.jobs.update(id, { priority: spec.priority, payload: spec.payload });
    }
  });
}

export class JobQueue {
  private running = false;

  constructor(
    private readonly db: TrailmapDb,
    private readonly now: () => number,
    private readonly handlers: JobHandlers,
    private readonly resultTables: readonly Table[] = [],
  ) {}

  /** Runs at most one due job. False means there is no work this worker can claim now. */
  async runNext(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const job = await this.claim();
      if (!job) return false;
      let attempt: Attempt;
      try {
        attempt = { result: await this.run(job) };
      } catch (error) {
        attempt = { error };
      }
      await this.finish(job, attempt);
      return true;
    } finally {
      this.running = false;
    }
  }

  private run<K extends JobKind>(job: Job<K>) {
    return this.handlers[job.kind](job);
  }

  /** A status check can recover a missed auth event, but cannot clear a provider ineligibility decision. */
  async accountChanged(explicitSignIn = false): Promise<void> {
    await this.db.transaction('rw', this.db.queueHolds, async () => {
      const hold = await this.db.queueHolds.get('ai');
      if (!hold || hold.reason === 'usage_limit_exceeded' || (hold.reason === 'not_eligible' && !explicitSignIn)) return;
      await this.db.queueHolds.delete('ai');
    });
  }

  private async claim() {
    const { jobs, queueHolds } = this.db;
    return this.db.transaction('rw', jobs, queueHolds, async () => {
      const now = this.now();
      const hold = await queueHolds.get('ai');
      if (hold && (hold.reason !== 'usage_limit_exceeded' || hold.retryAt > now)) return;
      const leased = await jobs.where('status').equals('leased').first();
      if (leased?.lease && leased.lease.until > now) return;
      if (leased) await jobs.update(leased.id, { status: 'pending', lease: undefined });
      const next = await jobs.where('[status+priority+createdAt]')
        .between(['pending', 0, -Infinity], ['pending', Infinity, Infinity])
        .filter(({ availableAt }) => availableAt <= now).first();
      if (!next) return;
      const job = { ...next, status: 'leased', lease: { token: crypto.randomUUID(), until: now + JOB_LEASE_MS } } as const;
      await jobs.put(job);
      return job;
    });
  }

  private async finish(job: Job, attempt: Attempt) {
    const { jobs, queueHolds } = this.db;
    await this.db.transaction('rw', [jobs, queueHolds, ...this.resultTables], async () => {
      const current = await jobs.get(job.id);
      // A stale worker must not commit a result or overwrite the next worker's hold.
      if (!current?.lease || current.lease.token !== job.lease?.token || current.lease.until <= this.now()) return;
      const hold = await queueHolds.get('ai');
      if ('error' in attempt) {
        const change = failure(job, attempt.error, hold, this.now());
        await jobs.update(job.id, { ...change.job, lease: undefined });
        if (change.hold) await queueHolds.put(change.hold);
        return;
      }
      const { result } = attempt;
      if (result === 'discard') { await jobs.delete(job.id); return; }
      if (result && 'retryAt' in result) {
        await jobs.update(job.id, { status: 'pending', availableAt: result.retryAt, lease: undefined });
        return;
      }
      if (result) await result.commit();
      await jobs.update(job.id, { status: 'done', lease: undefined });
      if (hold?.reason === 'usage_limit_exceeded') await queueHolds.delete('ai');
    });
  }
}

function failure(job: Job, error: unknown, hold: QueueHold | undefined, now: number): JobChange {
  const code = error instanceof CompanionRequestError ? error.code : undefined;
  switch (code) {
    case 'usage_limit_exceeded': {
      const probes = hold?.reason === 'usage_limit_exceeded' ? hold.probes + 1 : 0;
      const retryAt = now + Math.min(MAX_LIMIT_PROBE_MS, FIRST_LIMIT_PROBE_MS * 2 ** probes);
      return { job: { status: 'pending' }, hold: { id: 'ai', reason: code, retryAt, probes } };
    }
    case 'not_eligible':
    case 'not_signed_in':
    case 'plan_usage_not_granted':
      return { job: { status: 'pending' }, hold: { id: 'ai', reason: code } };
    case 'not_connected':
    case 'usage_unavailable':
    case 'timeout': {
      const failures = job.failures + 1;
      const hint = error instanceof CompanionRequestError ? error.details?.retryAfterMs ?? 0 : 0;
      const delay = code === 'not_connected' ? 30_000 : Math.min(TRANSIENT_MAX_MS, Math.max(hint, 5_000 * 2 ** (failures - 1)));
      const retryAt = now + delay;
      return {
        job: { status: 'pending', failures: code === 'not_connected' ? job.failures : failures, availableAt: retryAt },
        hold: hold?.reason === 'usage_limit_exceeded' ? { ...hold, retryAt } : undefined,
      };
    }
    default:
      return { job: { status: 'failed' } }; // Invalid output or request/configuration needs a change, not a loop.
  }
}
