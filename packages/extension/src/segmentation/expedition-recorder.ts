import Dexie from 'dexie';
import type { Expedition, Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { type Embedder, quantize } from '../embeddings/embedder';
import { EXPEDITION_WINDOW_MS, VISIT_TITLE_GRACE_MS } from './config';
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
  /** Called once for each closure transaction, after the closed rows are visible. */
  onClosed?: (expeditions: Expedition[]) => void;
};

export class ExpeditionRecorder {
  private queue = Promise.resolve();
  private titleTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: Options) {}

  sync() {
    const through = this.options.now();
    return this.enqueue(() => this.drain(through, true));
  }

  close(at: number) {
    return this.enqueue(async () => {
      await this.drain(at, false);
      const { db, onClosed } = this.options;
      const closed = await db.transaction('rw', db.expeditions, async () => {
        const open = await db.expeditions.filter((expedition) =>
          expedition.endedAt === null && expedition.startedAt <= at,
        ).toArray();
        const ended = open.map((expedition) => ({ ...expedition, endedAt: at }));
        await db.expeditions.bulkPut(ended);
        return ended;
      });
      if (closed.length) onClosed?.(closed);
    });
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
      if (!pending) return;
      const visit = await this.unassignedAncestor(pending);
      const query = await db.queries.where('visitId').equals(visit.id).first();
      const wait = visit.startedAt + VISIT_TITLE_GRACE_MS - now();
      if (waitForTitle && !visit.expeditionId && !query && !visit.title.trim() && wait > 0) {
        // Chrome normally reports the title shortly after committing the Visit.
        // The capture alarm retries this row if the service worker stops first.
        this.titleTimer = setTimeout(() => void this.sync().catch(() => {}), wait);
        return;
      }
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

  private async assign(visit: Visit, query?: string) {
    const { db, embedder } = this.options;
    const parentVisit = visit.parentVisitId ? await db.visits.get(visit.parentVisitId) : undefined;
    const parent = parentVisit?.expeditionId ? await db.expeditions.get(parentVisit.expeditionId) : undefined;
    const candidates = visit.expeditionId || parent?.endedAt === null ? [] : await db.expeditions.where('startedAt')
      .between(visit.startedAt - EXPEDITION_WINDOW_MS, visit.startedAt, true, true).reverse().toArray();
    // Inference runs outside IndexedDB transactions, which auto-commit when idle.
    const { expeditionId, embedding } = visit.expeditionEmbedding !== undefined
      ? { expeditionId: null, embedding: visit.expeditionEmbedding }
      : await segmentVisit({ visit, query, parent, candidates, embedder });

    await db.transaction('rw', db.visits, db.queries, db.expeditions, async () => {
      const current = await db.visits.get(visit.id);
      if (!current?.segmentationPending) return;
      const selected = expeditionId ? await db.expeditions.get(expeditionId) : undefined;
      const id = current.expeditionId ?? (selected?.endedAt === null ? selected.id : `expedition:${current.id}`);
      const existing = await db.expeditions.get(id);
      const label = query?.trim() || visit.title.trim();

      if (!existing) {
        await db.expeditions.add({
          id, rootVisitId: current.id, title: label || URL.parse(current.canonicalUrl)?.hostname || 'Untitled page',
          kind: 'learning', startedAt: current.startedAt, endedAt: null, centroid: null,
          drivingQuestion: null, fieldNotes: null, userEdited: false, threadId: null,
        });
      } else if (existing.rootVisitId === current.id && label && !existing.userEdited && existing.endedAt === null) {
        await db.expeditions.update(id, { title: label });
      }

      await db.visits.update(current.id, {
        expeditionId: id, expeditionEmbedding: embedding,
        segmentationPending: !label && current.title.trim() ? 1 : undefined,
      });
      if (embedding && visit.expeditionEmbedding === undefined) await refreshExpeditionCentroid(db, id);
      if (!current.expeditionId) {
        await db.queries.where('visitId').equals(current.id).modify({ expeditionId: id });
      }
    });
  }
}
