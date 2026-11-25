import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { openTrailmapDb, type TrailmapDb } from '../db/db';
import { buildExpeditionTrail } from '../trail/graph';

export function readJournal(db: TrailmapDb) {
  return db.expeditions.orderBy('startedAt').reverse().toArray();
}

export function readExpedition(db: TrailmapDb, id: string) {
  return db.transaction('r', db.expeditions, db.visits, db.queries, db.pages, async () => {
    const expedition = await db.expeditions.get(id);
    if (!expedition) return null;
    const [visits, queries, expeditions] = await Promise.all([
      db.visits.where('expeditionId').equals(id).toArray(),
      db.queries.where('expeditionId').equals(id).toArray(),
      readJournal(db),
    ]);
    const pages = await db.pages.bulkGet([...new Set(visits.map(({ canonicalUrl }) => canonicalUrl))]);
    const pageNotes = new Map(pages.flatMap((page) => page ? [[page.canonicalUrl, {
      summary: page.summary, takeaways: page.takeaways,
    }] as const] : []));
    const summaries = new Map([...pageNotes].map(([url, { summary }]) => [url, summary]));
    const alternatives = expeditions.filter((other) => other.id !== id).map(({ id, title }) => ({ id, title }));
    return { expedition, visits, graph: buildExpeditionTrail(visits, queries), pageNotes, summaries, alternatives };
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
