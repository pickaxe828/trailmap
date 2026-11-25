import { liveQuery } from 'dexie';
import type { Expedition, Page, Visit } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import { openTrailmapDb } from '../db/db';
import { startOfLocalDay } from './tree';

export type TrailPageNotes = Pick<Page, 'canonicalUrl' | 'takeaways'> & { title: string; summary: string };

type LiveTrail = {
  open: { expedition: Expedition; visits: Visit[] }[];
  today: Visit[];
  pageNotes: TrailPageNotes[];
  /** Wrapped-up Expeditions, newest first. */
  finished: Expedition[];
  /** The user's own Note text, by Visit or Expedition id. */
  notes: Record<string, string>;
};

let db: ReturnType<typeof openTrailmapDb> | undefined;

/** Keep expedition headings and memberships in the same live snapshot. */
export function useLiveTrail(): LiveTrail | undefined {
  const [trail, setTrail] = useState<LiveTrail>();
  useEffect(() => {
    const database = db ??= openTrailmapDb();
    const subscription = liveQuery(() =>
      database.transaction('r', database.expeditions, database.visits, database.pages, database.notes, async () => {
        const expeditions = await database.expeditions.orderBy('startedAt').reverse()
          .filter(({ endedAt }) => endedAt === null).toArray();
        const openIds = new Set(expeditions.map(({ id }) => id));
        const open = await Promise.all(expeditions.map(async (expedition) => ({
          expedition,
          visits: await database.visits.where('expeditionId').equals(expedition.id).toArray(),
        })));
        const today = await database.visits.where('startedAt').aboveOrEqual(startOfLocalDay(Date.now()))
          .filter(({ expeditionId }) => expeditionId === null || !openIds.has(expeditionId)).toArray();
        const engaged = [...open.flatMap(({ visits }) => visits), ...today]
          .filter((visit) => visit.engagement !== 'bounced' && !visit.privacyBlocked)
          .sort((a, b) => b.startedAt - a.startedAt);
        const titles = new Map<string, string>();
        for (const { canonicalUrl, title } of engaged) {
          if (!titles.has(canonicalUrl)) titles.set(canonicalUrl, title);
        }
        const pageNotes = (await database.pages.bulkGet([...titles.keys()])).flatMap((page) =>
          page?.summary && page.enrichedAt !== null ? [{
            canonicalUrl: page.canonicalUrl, title: titles.get(page.canonicalUrl) || new URL(page.canonicalUrl).hostname,
            summary: page.summary, takeaways: page.takeaways,
          }] : []);
        const finished = await database.expeditions.orderBy('endedAt').reverse()
          .filter((expedition) => expedition.endedAt !== null && expedition.wrappedUpAt !== undefined).limit(10).toArray();
        const nodeIds = [...open.flatMap(({ expedition, visits }) => [expedition.id, ...visits.map(({ id }) => id)]),
          ...today.map(({ id }) => id)];
        const notes = Object.fromEntries((await database.notes.where('nodeId').anyOf(nodeIds).toArray())
          .map(({ nodeId, text }) => [nodeId, text]));
        return { open, today, pageNotes, notes, finished };
      }),
    ).subscribe({ next: setTrail });
    return () => subscription.unsubscribe();
  }, []);
  return trail;
}
