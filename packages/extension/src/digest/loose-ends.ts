import type { Expedition } from '@trailmap/shared';
import { oneLine } from '../wrapup/markdown';

export type LooseEnd = { expeditionId: string; text: string; /** An unread tab can be opened directly. */ href?: string };

const NOTHING_OPEN = 'Nothing left open.';
const stripLinks = (text: string) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/**
 * The open loose ends of an Expedition, read live from its notes: the bullets under "Loose ends" in the field notes (with
 * any Markdown links reduced to their words) and the tabs that were opened but never read. Nothing here is stored or sent to a model.
 */
export function readLooseEnds({ id, fieldNotes, unreadStops }: Pick<Expedition, 'id' | 'fieldNotes' | 'unreadStops'>): LooseEnd[] {
  const ends: LooseEnd[] = (unreadStops ?? []).map(({ title, url }) => ({ expeditionId: id, text: `Opened but never read: ${oneLine(title)}`, href: url }));
  const start = fieldNotes?.lastIndexOf('## Loose ends') ?? -1;
  if (fieldNotes && start >= 0) {
    for (const line of fieldNotes.slice(start).split('\n').slice(1)) {
      if (line.startsWith('#')) break;
      const text = oneLine(stripLinks(line.replace(/^\s*[-*]\s+/, '')));
      if (line.trimStart().match(/^[-*]\s/) && text && text !== NOTHING_OPEN && !text.startsWith('Opened but never read')) ends.push({ expeditionId: id, text });
    }
  }
  return ends;
}
