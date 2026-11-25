import { liveQuery } from 'dexie';
import type { TrailmapDb } from '../db/db';

export const countUnseenNotes = (db: TrailmapDb) => db.expeditions.where('unseenNotes').equals(1).count();

/** Viewing an Expedition's field notes (side panel now, the Journal later) clears its share of the badge. */
export async function markNotesSeen(db: TrailmapDb, expeditionId: string) {
  await db.expeditions.update(expeditionId, { unseenNotes: undefined });
}

/** Calls `onChange` with the new count whenever it changes; returns an unsubscribe. */
export function watchUnseenNotes(db: TrailmapDb, onChange: (count: number) => void): () => void {
  const sub = liveQuery(() => countUnseenNotes(db)).subscribe({ next: onChange, error: () => {} });
  return () => sub.unsubscribe();
}
