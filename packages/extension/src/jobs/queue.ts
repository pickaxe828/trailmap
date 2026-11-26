import type { Table } from 'dexie';
import { CompanionRequestError } from '../companion/client';
import type { TrailmapDb } from '../db/db';
import type { ModelRoute } from '../llm/settings';
import { canRetryModelJob, isModelJob, type Job, type JobKind, type JobSpec, type ModelJobKind, type QueueHold } from './types';

export { JOB_PRIORITY, type JobPriority } from './types';

// Longer than the companion's bounded inference and Native Messaging deadlines.
export const JOB_LEASE_MS = 4 * 60_000;
const FIRST_LIMIT_PROBE_MS = 30 * 60_000;
const MAX_LIMIT_PROBE_MS = 6 * 60 * 60_000;
const TRANSIENT_MAX_MS = 15 * 60_000;
const ATTENTION_WINDOW_MS = 10 * 60_000;

type JobDisposition = void | { retryAt: number } | 'discard';
export type JobResult = JobDisposition | { commit: () => Promise<JobDisposition>; localOnly?: true };
export type JobHandlers = { [K in JobKind]: (job: Job<K>, route?: ModelRoute) => Promise<JobResult> };

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
  async runNext(routeFor: (job: Job) => ModelRoute | undefined = ({ kind }) => isModelJob(kind) ? { provider: 'chatgpt' } : undefined): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const claimed = await this.claim(routeFor);
      if (!claimed) return false;
      const { job, route } = claimed;
      let attempt: Attempt;
      try {
        attempt = { result: await this.run(job, route) };
      } catch (error) {
        attempt = { error };
      }
      await this.finish(job, attempt, route);
      return true;
    } finally {
      this.running = false;
    }
  }

  private run<K extends JobKind>(job: Job<K>, route?: ModelRoute) {
    return this.handlers[job.kind](job, route);
  }

  /** Bring failed and backed-off jobs of this kind forward, without taking over a lease. */
  async retryNow(kind: ModelJobKind, route: ModelRoute): Promise<number> {
    const { jobs, queueHolds } = this.db;
    return this.db.transaction('rw', jobs, queueHolds, async () => {
      const now = this.now();
      const hold = route.provider === 'chatgpt' ? await queueHolds.get('ai') : undefined;
      const count = await jobs.where('status').anyOf('failed', 'pending')
        .and((job) => job.kind === kind && canRetryModelJob(job, hold, now))
        .modify({ status: 'pending', availableAt: now });
      if (count && hold?.reason === 'usage_limit_exceeded') {
        const probe = { ...hold, retryAt: now };
        await queueHolds.put(probe);
      }
      return count;
    });
  }

  /** A status check can recover a missed auth event, but cannot clear a provider ineligibility decision. */
  async accountChanged(explicitSignIn = false): Promise<void> {
    await this.db.transaction('rw', this.db.queueHolds, async () => {
      const hold = await this.db.queueHolds.get('ai');
      if (!hold || hold.reason === 'usage_limit_exceeded' || (hold.reason === 'not_eligible' && !explicitSignIn)) return;
      await this.db.queueHolds.delete('ai');
    });
  }

  private async claim(routeFor: (job: Job) => ModelRoute | undefined) {
    const { jobs, queueHolds } = this.db;
    return this.db.transaction('rw', jobs, queueHolds, async () => {
      const now = this.now();
      const hold = await queueHolds.get('ai');
      const planHeld = hold && (hold.reason !== 'usage_limit_exceeded' || hold.retryAt > now);
      const leased = await jobs.where('status').equals('leased').first();
      if (leased?.lease && leased.lease.until > now) return;
      if (leased) await jobs.update(leased.id, { status: 'pending', lease: undefined });
      const next = await jobs.where('[status+priority+createdAt]')
        .between(['pending', 0, -Infinity], ['pending', Infinity, Infinity])
        .filter((job) => job.availableAt <= now && (!planHeld || routeFor(job)?.provider !== 'chatgpt')).first();
      if (!next) return;
      const job = { ...next, status: 'leased', lease: { token: crypto.randomUUID(), until: now + JOB_LEASE_MS } } as const;
      await jobs.put(job);
      return { job, route: routeFor(job) };
    });
  }

  private async finish(job: Job, attempt: Attempt, route: ModelRoute | undefined) {
    const { jobs, queueHolds, modelHealth } = this.db;
    const usesChatGptPlan = route?.provider === 'chatgpt';
    await this.db.transaction('rw', [jobs, queueHolds, modelHealth, ...this.resultTables], async () => {
      const current = await jobs.get(job.id);
      // A stale worker must not commit a result or overwrite the next worker's hold.
      if (!current?.lease || current.lease.token !== job.lease?.token || current.lease.until <= this.now()) return;
      const hold = await queueHolds.get('ai');
      if ('error' in attempt) {
        const at = this.now();
        const code = attempt.error instanceof CompanionRequestError ? attempt.error.code : 'internal';
        const change = failure(job, attempt.error, usesChatGptPlan ? hold : undefined, at);
        const lastError = { code, at, attempts: (job.lastError?.attempts ?? job.failures) + 1 };
        await jobs.update(job.id, { ...change.job, lastError, lease: undefined });
        if (change.hold) await queueHolds.put(change.hold);
        if (route && code !== 'dispatch_cancelled') {
          const previous = await modelHealth.get('jobs');
          const sameCode = previous?.code === code ? previous.recent : [];
          const recent = [...sameCode.filter((time) => time >= at - ATTENTION_WINDOW_MS && time <= at), at].slice(-3);
          const attention = recent.length === 3 ? { code, provider: route.provider } : previous?.attention;
          await modelHealth.put({ id: 'jobs', code, recent, attention });
        }
        return;
      }
      const pending = attempt.result;
      const commit = typeof pending === 'object' && 'commit' in pending;
      const result = commit ? await pending.commit() : pending;
      if (result === 'discard') { await jobs.delete(job.id); return; }
      if (result && 'retryAt' in result) {
        await jobs.update(job.id, { status: 'pending', availableAt: result.retryAt, lease: undefined });
        return;
      }
      await jobs.update(job.id, { status: 'done', lease: undefined });
      if (route && !(commit && pending.localOnly)) {
        await modelHealth.delete('jobs');
        if (usesChatGptPlan && hold?.reason === 'usage_limit_exceeded') await queueHolds.delete('ai');
      }
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
    case 'provider_unreachable':
    case 'provider_rate_limited':
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
