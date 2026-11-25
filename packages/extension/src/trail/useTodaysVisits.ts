import { liveQuery } from 'dexie';
import type { Visit } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import { openTrailmapDb } from '../db/db';
import { startOfLocalDay } from './tree';

let db: ReturnType<typeof openTrailmapDb> | undefined;

/** Today's Visits (local day), re-read whenever the database changes, including writes made by the background. */
export function useTodaysVisits(): Visit[] | undefined {
  const [visits, setVisits] = useState<Visit[]>();
  useEffect(() => {
    db ??= openTrailmapDb();
    const database = db;
    const subscription = liveQuery(() =>
      database.visits.where('startedAt').aboveOrEqual(startOfLocalDay(Date.now())).toArray(),
    ).subscribe({ next: setVisits, error: () => setVisits([]) });
    return () => subscription.unsubscribe();
  }, []);
  return visits;
}
