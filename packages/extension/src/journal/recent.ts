import type { TrailmapDb } from '../db/db';

export const RECENT_CHANGES_LIMIT = 20;
export type RecentChange = { id: string; at: number; label: string };
export type UndoRefusal = 'forgotten' | 'undone' | 'conflict';

type Logged = { snapshot?: { expeditions?: { id: string; title: string }[] }; selected?: string[]; action?: string; toKind?: string };

const quote = (titles: string[]) => {
  const shown = titles.slice(0, 2).map((title) => `“${title || 'Untitled'}”`);
  const more = titles.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(' and ');
};

function describe(kind: string, data: Logged): string {
  const titles = (data.selected ?? []).flatMap((id) => data.snapshot?.expeditions?.find((item) => item.id === id)?.title ?? []);
  const names = titles.length ? quote(titles) : 'expeditions';
  switch (data.action ?? kind.replace('journal-', '')) {
    case 'merge': return `Merged ${names}`;
    case 'start': return `Started a thread from ${names}`;
    case 'add': return `Added ${names} to a thread`;
    case 'dismiss': return `Dismissed a suggestion for ${names}`;
    case 'classify': return data.toKind === 'learning' ? `Marked ${names} as learning`
      : data.toKind === 'errand' ? `Marked ${names} as not learning` : `Changed whether ${names} is learning`;
    default: return 'Changed the Journal';
  }
}

/** The latest Journal organise actions that can still be undone, read from the durable corrections log. */
export async function readRecentChanges(db: TrailmapDb): Promise<RecentChange[]> {
  const rows = await db.corrections.orderBy('at').reverse()
    .filter(({ kind, before }) => kind.startsWith('journal-') && kind !== 'journal-undo' && !!before && typeof before === 'object')
    .limit(RECENT_CHANGES_LIMIT).toArray();
  return rows.map(({ id, at, kind, before }) => ({ id, at, label: describe(kind, before as Logged) }));
}

/** Why an undo was refused. A forgotten change has no log row at all; an undone one keeps a row with no payload. */
export async function undoRefusal(db: TrailmapDb, id: string): Promise<UndoRefusal> {
  const entry = await db.corrections.get(id);
  return !entry ? 'forgotten' : entry.before === null ? 'undone' : 'conflict';
}

export const REFUSAL_MESSAGE: Record<UndoRefusal, string> = {
  forgotten: 'Could not undo: the data for this change was forgotten, so it can’t be restored.',
  undone: 'This change was already undone.',
  conflict: 'Could not undo: a later change touched the same expeditions. Undo that change first.',
};
