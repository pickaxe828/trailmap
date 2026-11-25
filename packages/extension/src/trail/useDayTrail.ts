import type { ISODateString } from '@astryxdesign/core/Calendar';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { openTrailmapDb } from '../db/db';
import { buildTrailGraph, type TrailGraph } from './graph';

export function localDateKey(date: Date): ISODateString {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as ISODateString;
}

type DayTrail = { day: string; graph: TrailGraph } | { day: string; error: true };

export function useDayTrail(day: string): DayTrail | undefined {
  const [result, setResult] = useState<DayTrail>();
  useEffect(() => {
    // ISO date without a time parses as UTC. The time suffix keeps both bounds
    // local, and advancing the calendar (not 24h) covers DST transitions.
    const start = new Date(`${day}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const db = openTrailmapDb();
    const subscription = liveQuery(() => db.transaction('r', db.visits, db.queries, async () => {
      const [visits, queries] = await Promise.all([
        db.visits.where('startedAt').between(+start, +end, true, false).toArray(),
        db.queries.where('at').between(+start, +end, true, false).toArray(),
      ]);
      return buildTrailGraph(visits, queries);
    })).subscribe({ next: (graph) => setResult({ day, graph }), error: () => setResult({ day, error: true }) });
    return () => {
      subscription.unsubscribe();
      db.close();
    };
  }, [day]);
  return result?.day === day ? result : undefined;
}
