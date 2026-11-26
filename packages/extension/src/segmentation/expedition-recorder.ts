import Dexie from 'dexie';
import type { Expedition, Query, Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { type Embedder, quantize } from '../embeddings/embedder';
import { DEFAULT_EXPEDITION_INACTIVITY_MINUTES, DEFAULT_TOPIC_SWITCH_MINUTES, EXPEDITION_WINDOW_MS, VISIT_TITLE_GRACE_MS } from './config';
import { planExpeditionClosures, type ExpeditionTiming } from './close-rules';
import { enqueueWrapUp } from '../wrapup/enqueue';
import { segmentVisit } from './segmenter';

/** Rebuild after changing Visit membership. Call within the same transaction as the move. */
export async function refreshExpeditionCentroid(db: TrailmapDb, expeditionId: string) {
  let sum: Float64Array | undefined;
  await db.visits.where('expeditionId').equals(expeditionId).each(({ expeditionEmbedding }) => {
    if (!expeditionEmbedding) return;
    sum ??= new Float64Array(expeditionEmbedding.length);
    if (sum.length !== expeditionEmbedding.length) return;
    for (const [i, value] of expeditionEmbedding.entries()) sum[i] = sum[i]! + value;
  });
  await db.expeditions.update(expeditionId, { centroid: sum ? quantize(sum) : null });
}

type Options = {
  db: TrailmapDb;
  embedder: Embedder;
  now: () => number;
  timing?: () => ExpeditionTiming;
  onDeadline?: (deadline: number | null) => Promise<void>;
  /** Called once for each closure transaction, after the closed rows are visible. */
  onClosed?: (expeditions: Expedition[]) => void;
};

type Replay = {
  sessionStart: number;
  query?: Query;
  canImport: (visit: Visit) => boolean;
};

type Closure = { id: string; endedAt: number };
const defaultTiming: ExpeditionTiming = {
  inactivityMs: DEFAULT_EXPEDITION_INACTIVITY_MINUTES * 60_000,
  topicSwitchMs: DEFAULT_TOPIC_SWITCH_MINUTES * 60_000,
};

export class ExpeditionRecorder {
  private queue = Promise.resolve();
  private titleTimer?: ReturnType<typeof setTimeout>;
  private previousSessionCutoff?: number;

  constructor(private readonly options: Options) {}

  private timing() {
    return this.options.timing?.() ?? defaultTiming;
  }

  recover(sessionStartedAt: number) {
    return this.enqueue(async () => {
      this.previousSessionCutoff = sessionStartedAt;
      await this.drainPreviousSession();
    });
  }

  sync() {
    const through = this.options.now();
    return this.enqueue(async () => {
      await this.drainPreviousSession();
      // A Visit waiting for its title may extend an Expedition. The title timer
      // (or next capture tick after a worker restart) retries the deadline check.
      if (!await this.drain(through, true)) return;
      const deadline = await this.closeByRules(through);
      await this.options.onDeadline?.(deadline);
    });
  }

  private async drainPreviousSession() {
    const sessionStartedAt = this.previousSessionCutoff;
    if (sessionStartedAt === undefined) return;
    try {
      await this.drain(sessionStartedAt - 1, false);
    } finally {
      // Include pending Visits before ending their Expeditions. If assignment
      // fails, still close prior sessions and leave pending rows for retry.
      await this.closeByRules(sessionStartedAt - 1, { sessionStartedAt });
    }
    this.previousSessionCutoff = undefined;
  }

  /**
   * Closes every open Expedition (idle), or just `only` (the Wrap up button).
   * The wrap-up job is queued in the closure transaction, so a closed
   * Expedition always has one, even if the worker stops right after the commit.
   */
  close(at: number, only?: string) {
    return this.enqueue(async () => {
      await this.drainPreviousSession();
      await this.drain(at, false);
      const { db, onClosed } = this.options;
      const closed = await db.transaction('rw', db.visits, db.expeditions, db.jobs, async () => {
        const activity = await this.readOpenActivity(at, only);
        return this.endExpeditions(activity.map(({ id, lastActiveAt }) => ({ id, endedAt: Math.min(at, lastActiveAt) })));
      });
      if (closed.length) onClosed?.(closed);
    });
  }

  private async readOpenActivity(through: number, only?: string) {
    const { db } = this.options;
    const open = (only === undefined
      ? await db.expeditions.filter(({ endedAt }) => endedAt === null).toArray()
      : [await db.expeditions.get(only)]).filter((expedition): expedition is Expedition =>
      !!expedition && expedition.endedAt === null && expedition.startedAt <= through);
    const activity = new Map(open.map(({ id, startedAt }) => [id, startedAt]));
    await db.visits.where('expeditionId').anyOf([...activity.keys()]).each((visit) => {
      if (visit.privacyBlocked || visit.startedAt > through) return;
      // For older rows, total reading time is a lower bound on when reading ended.
      const last = visit.lastActiveAt ?? visit.startedAt + visit.activeMs;
      const id = visit.expeditionId!;
      activity.set(id, Math.max(activity.get(id)!, visit.startedAt, last));
    });
    return open.map(({ id, startedAt, endedAt }) => ({ id, startedAt, endedAt, lastActiveAt: activity.get(id)! }));
  }

  private async endExpeditions(closures: Closure[]) {
    const { db, now } = this.options;
    const ended: Expedition[] = [];
    for (const { id, endedAt } of closures) {
      const expedition = await db.expeditions.get(id);
      if (expedition?.endedAt !== null) continue;
      await db.expeditions.update(id, { endedAt });
      const closed = { ...expedition, endedAt };
      await enqueueWrapUp(db, closed, now());
      ended.push(closed);
    }
    return ended;
  }

  private async closeByRules(at: number, trigger?: { sessionStartedAt: number }) {
    const { db, onClosed } = this.options;
    const { closed, nextDeadline } = await db.transaction('rw', db.visits, db.expeditions, db.jobs, async () => {
      const { closures, nextDeadline } = planExpeditionClosures(await this.readOpenActivity(at), at, this.timing(), trigger);
      return { closed: await this.endExpeditions(closures), nextDeadline };
    });
    if (closed.length) onClosed?.(closed);
    return nextDeadline;
  }

  /** Commit a historical stop and its assignment together. Replay never opens live Expeditions. */
  async importVisit(visit: Visit, replay: Replay): Promise<boolean> {
    if (!replay.canImport(visit) || await this.options.db.visits.get(visit.id)) return false;
    return this.assign(visit, replay.query?.q, replay);
  }

  private enqueue(work: () => Promise<void>) {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  private async drain(through: number, waitForTitle: boolean) {
    const { db, now } = this.options;
    if (waitForTitle) clearTimeout(this.titleTimer);
    for (;;) {
      const pending = await db.visits.where('[segmentationPending+startedAt]')
        .between([1, Dexie.minKey], [1, through], true, true).first();
      if (!pending) return true;
      const visit = await this.unassignedAncestor(pending);
      const query = await db.queries.where('visitId').equals(visit.id).first();
      const wait = visit.startedAt + VISIT_TITLE_GRACE_MS - now();
      if (waitForTitle && !visit.expeditionId && !query && !visit.title.trim() && wait > 0) {
        // Chrome normally reports the title shortly after committing the Visit.
        // The capture alarm retries this row if the service worker stops first.
        this.titleTimer = setTimeout(() => void this.sync().catch(() => {}), wait);
        return false;
      }
      // When an alarm is late (e.g. after sleep), don't let a new Visit join
      // an Expedition whose inactivity deadline had already passed.
      if (!visit.expeditionId) await this.closeByRules(visit.startedAt);
      await this.assign(visit, query?.q);
    }
  }

  private async unassignedAncestor(visit: Visit): Promise<Visit> {
    // The compound index breaks timestamp ties by ID. Resolve lineage first
    // even when a parent and a child were captured in the same millisecond.
    while (!visit.expeditionId && visit.parentVisitId) {
      const parent = await this.options.db.visits.get(visit.parentVisitId);
      if (!parent?.segmentationPending || parent.expeditionId) break;
      visit = parent;
    }
    return visit;
  }

  private async assign(visit: Visit, query?: string, replay?: Replay): Promise<boolean> {
    const { db, embedder } = this.options;
    const parentVisit = visit.parentVisitId ? await db.visits.get(visit.parentVisitId) : undefined;
    const eligibleParent = parentVisit && (!replay || replay.canImport(parentVisit)) ? parentVisit : undefined;
    // During replay, Expeditions worked on since the last browsing gap count as open.
    // In the database they stay closed, even across cancellation or worker restart.
    function open(expedition: Expedition | undefined): Expedition | undefined {
      if (!expedition) return;
      if (!replay) return expedition.endedAt === null ? expedition : undefined;
      if (expedition.imported && expedition.endedAt !== null && expedition.endedAt >= replay.sessionStart &&
          expedition.startedAt <= visit.startedAt) return { ...expedition, endedAt: null };
    }
    const parent = eligibleParent?.expeditionId ? open(await db.expeditions.get(eligibleParent.expeditionId)) : undefined;
    const candidates = visit.expeditionId || parent ? [] : (await db.expeditions.where('startedAt')
      .between(visit.startedAt - EXPEDITION_WINDOW_MS, visit.startedAt, true, true).reverse().toArray()).flatMap((candidate) => {
      const session = open(candidate);
      return session ? [session] : [];
    });
    // Inference runs outside IndexedDB transactions, which auto-commit when idle.
    const { expeditionId, embedding } = visit.expeditionEmbedding !== undefined
      ? { expeditionId: null, embedding: visit.expeditionEmbedding }
      : await segmentVisit({ visit, query, parent, candidates, embedder });

    const changed = await db.transaction('rw', db.visits, db.queries, db.expeditions, db.jobs, async () => {
      const saved = await db.visits.get(visit.id);
      if (replay ? !!saved : !saved?.segmentationPending) return;
      const current = saved ?? visit;
      const selected = expeditionId ? open(await db.expeditions.get(expeditionId)) : undefined;
      const currentParent = replay && visit.parentVisitId ? await db.visits.get(visit.parentVisitId) : undefined;
      if (replay && !replay.canImport(current)) return;
      const parentVisitId = currentParent && replay?.canImport(currentParent) ? currentParent.id : null;
      const joined = selected && (!replay || !parent || (parentVisitId && currentParent?.expeditionId === selected.id));
      const id = current.expeditionId ?? (joined ? selected.id : `expedition:${current.id}`);
      const existing = await db.expeditions.get(id);
      const label = query?.trim() || visit.title.trim();

      if (!existing) {
        await db.expeditions.add({
          id, rootVisitId: current.id, title: label || URL.parse(current.canonicalUrl)?.hostname || 'Untitled page',
          kind: 'learning', startedAt: current.startedAt, endedAt: replay ? current.startedAt : null, centroid: null,
          drivingQuestion: null, fieldNotes: null, userEdited: false, threadId: null,
          ...(replay && { imported: true }),
        });
      } else if (replay) {
        const endedAt = Math.max(existing.endedAt ?? current.startedAt, current.startedAt);
        if (endedAt !== existing.endedAt) await db.expeditions.update(id, { endedAt });
      } else if (existing.rootVisitId === current.id && label && !existing.userEdited && existing.endedAt === null) {
        await db.expeditions.update(id, { title: label });
      }

      if (replay) {
        await db.visits.add({ ...current, parentVisitId, expeditionId: id, expeditionEmbedding: embedding });
        if (replay.query) await db.queries.add({ ...replay.query, expeditionId: id });
      } else {
        await db.visits.update(current.id, {
          expeditionId: id, expeditionEmbedding: embedding,
          segmentationPending: !label && current.title.trim() ? 1 : undefined,
        });
        if (!current.expeditionId) await db.queries.where('visitId').equals(current.id).modify({ expeditionId: id });
      }
      if (embedding && visit.expeditionEmbedding === undefined) await refreshExpeditionCentroid(db, id);
      if (replay || existing) return [];
      const at = current.startedAt;
      const { closures } = planExpeditionClosures(await this.readOpenActivity(at), at, this.timing(), { newExpeditionId: id });
      return this.endExpeditions(closures);
    });
    if (changed?.length) this.options.onClosed?.(changed);
    return changed !== undefined;
  }
}
