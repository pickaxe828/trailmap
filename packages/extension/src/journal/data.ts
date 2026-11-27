import type { Expedition } from '@trailmap/shared';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { buildExpeditionTrail } from '../trail/graph';

export function readJournal(db: TrailmapDb) {
  return db.expeditions.orderBy('startedAt').reverse().toArray();
}

/** Expeditions the user has written about: My notes, or a note on one of their stops. Call inside a read transaction. */
export async function readNotedExpeditions(db: TrailmapDb, expeditions: readonly Expedition[]): Promise<Set<string>> {
  const noted = new Set(expeditions.filter(({ myNotes }) => !!myNotes?.trim()).map(({ id }) => id));
  const nodeIds = (await db.notes.toArray()).flatMap(({ nodeId, text }) => text.trim() ? [nodeId] : []);
  const ids = new Set(expeditions.map(({ id }) => id));
  for (const id of nodeIds) if (ids.has(id)) noted.add(id);
  for (const node of [...await db.visits.bulkGet(nodeIds), ...await db.queries.bulkGet(nodeIds)]) {
    if (node?.expeditionId && ids.has(node.expeditionId)) noted.add(node.expeditionId);
  }
  return noted;
}

export function readExpedition(db: TrailmapDb, id: string) {
  return db.transaction('r', db.expeditions, db.visits, db.queries, db.pages, db.notes, async () => {
    const expedition = await db.expeditions.get(id);
    if (!expedition) return null;
    const [visits, queries, expeditions] = await Promise.all([
      db.visits.where('expeditionId').equals(id).toArray(),
      db.queries.where('expeditionId').equals(id).toArray(),
      readJournal(db),
    ]);
    const pages = await db.pages.bulkGet([...new Set(visits.map(({ canonicalUrl }) => canonicalUrl))]);
    const pageNotes = new Map(pages.flatMap((page) => page ? [[page.canonicalUrl, {
      summary: page.summary, takeaways: page.takeaways, aiTurns: page.aiTurns,
    }] as const] : []));
    const summaries = new Map([...pageNotes].map(([url, { summary }]) => [url, summary]));
    const alternatives = expeditions.filter((other) => other.id !== id).map(({ id, title }) => ({ id, title }));
    // The user's note on a stop, by its Trail node id (a search is its Visit, or `query:<id>` when it has none).
    const nodeOf = new Map([...visits.map(({ id }) => [id, id] as const),
      ...queries.map((query) => [query.id, query.visitId ?? `query:${query.id}`] as const)]);
    const stopNotes = new Map((await db.notes.where('nodeId').anyOf([...nodeOf.keys()]).toArray())
      .flatMap(({ nodeId, text }) => text.trim() ? [[nodeOf.get(nodeId)!, text.trim()] as const] : []));
    return { expedition, visits, graph: buildExpeditionTrail(visits, queries), pageNotes, summaries, alternatives, stopNotes };
  });
}

export type ExpeditionReview = NonNullable<Awaited<ReturnType<typeof readExpedition>>>;

type Result<T> = { data: T; error?: never } | { data?: never; error: true };

/** Subscribe to local data, including changes made by the background and other tabs. */
export function useJournalData<T>(read: (db: TrailmapDb) => Promise<T>): Result<T> | undefined {
  const [state, setState] = useState<{ read: typeof read; result: Result<T> }>();
  useEffect(() => {
    const db = openTrailmapDb();
    const subscription = liveQuery(() => read(db)).subscribe({
      next: (data) => setState({ read, result: { data } }),
      error: () => setState({ read, result: { error: true } }),
    });
    return () => { subscription.unsubscribe(); db.close(); };
  }, [read]);
  return state?.read === read ? state.result : undefined;
}
