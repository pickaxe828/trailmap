import { liveQuery } from 'dexie';
import type { Expedition, Visit } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import { openTrailmapDb } from '../db/db';
import { startOfLocalDay } from './tree';

type LiveTrail = {
  open: { expedition: Expedition; visits: Visit[] }[];
  today: Visit[];
};

let db: ReturnType<typeof openTrailmapDb> | undefined;

/** Keep expedition headings and memberships in the same live snapshot. */
export function useLiveTrail(): LiveTrail | undefined {
  const [trail, setTrail] = useState<LiveTrail>();
  useEffect(() => {
    const database = db ??= openTrailmapDb();
    const subscription = liveQuery(() =>
      database.transaction('r', database.expeditions, database.visits, async () => {
        const expeditions = await database.expeditions.orderBy('startedAt').reverse()
          .filter(({ endedAt }) => endedAt === null).toArray();
        const openIds = new Set(expeditions.map(({ id }) => id));
        const open = await Promise.all(expeditions.map(async (expedition) => ({
          expedition,
          visits: await database.visits.where('expeditionId').equals(expedition.id).toArray(),
        })));
        const today = await database.visits.where('startedAt').aboveOrEqual(startOfLocalDay(Date.now()))
          .filter(({ expeditionId }) => expeditionId === null || !openIds.has(expeditionId)).toArray();
        return { open, today };
      }),
    ).subscribe({ next: setTrail });
    return () => subscription.unsubscribe();
  }, []);
  return trail;
}
