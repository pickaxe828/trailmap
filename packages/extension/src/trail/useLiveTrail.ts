import { liveQuery } from 'dexie';
import type { Expedition, Visit } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import { googleSearchSurface } from '../capture/search';
import { openTrailmapDb } from '../db/db';
import { startOfLocalDay } from './tree';

type LiveTrail = {
  open: { expedition: Expedition; visits: Visit[] }[];
  today: Visit[];
  /** Wrapped-up Expeditions, newest first. */
  finished: Expedition[];
  /** The user's own Note text, by Visit or Expedition id. */
  notes: Record<string, string>;
  aiFollowUps: Record<string, { count: number; latest: string }>;
};

let db: ReturnType<typeof openTrailmapDb> | undefined;

/** Keep expedition headings and memberships in the same live snapshot. */
export function useLiveTrail(): LiveTrail | undefined {
  const [trail, setTrail] = useState<LiveTrail>();
  useEffect(() => {
    const database = db ??= openTrailmapDb();
    const subscription = liveQuery(() =>
      database.transaction('r', database.expeditions, database.visits, database.notes, database.pages, async () => {
        const expeditions = await database.expeditions.orderBy('startedAt').reverse()
          .filter(({ endedAt }) => endedAt === null).toArray();
        const openIds = new Set(expeditions.map(({ id }) => id));
        const open = await Promise.all(expeditions.map(async (expedition) => ({
          expedition,
          visits: await database.visits.where('expeditionId').equals(expedition.id).toArray(),
        })));
        const today = await database.visits.where('startedAt').aboveOrEqual(startOfLocalDay(Date.now()))
          .filter(({ expeditionId }) => expeditionId === null || !openIds.has(expeditionId)).toArray();
        const finished = await database.expeditions.orderBy('endedAt').reverse()
          .filter((expedition) => expedition.endedAt !== null && expedition.wrappedUpAt !== undefined).limit(10).toArray();
        const visits = [...open.flatMap((group) => group.visits), ...today];
        const nodeIds = [...openIds, ...visits.map(({ id }) => id)];
        const notes = Object.fromEntries((await database.notes.where('nodeId').anyOf(nodeIds).toArray())
          .map(({ nodeId, text }) => [nodeId, text]));
        const conversations = visits.filter(({ aiConversation, url }) => aiConversation && googleSearchSurface(url) === 'ai-mode');
        const pages = await database.pages.bulkGet(conversations.map(({ canonicalUrl }) => canonicalUrl));
        const aiFollowUps: LiveTrail['aiFollowUps'] = {};
        for (const [index, page] of pages.entries()) {
          const turns = page?.aiTurns;
          if (turns && turns.length > 1) {
            aiFollowUps[conversations[index]!.id] = { count: turns.length, latest: turns.at(-1)!.question };
          }
        }
        return { open, today, notes, finished, aiFollowUps };
      }),
    ).subscribe({ next: setTrail });
    return () => subscription.unsubscribe();
  }, []);
  return trail;
}
