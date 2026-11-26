import type { Expedition } from '@trailmap/shared';

export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const linkText = (text: string) => oneLine(text).replace(/[\\[\]]/g, '\\$&');
export const markdownLink = ({ title, url }: { title: string; url: string }) =>
  `[${linkText(title)}](${url.replace(/[()\s]/g, encodeURIComponent)})`;

const LOOSE_ENDS = '## Loose ends\n\n';

/** Only presentation and export add local unread tab links. Model callers use fieldNotes as stored. */
export function displayFieldNotes({ fieldNotes, unreadStops }: Pick<Expedition, 'fieldNotes' | 'unreadStops'>): string | null {
  if (!fieldNotes || !unreadStops?.length) return fieldNotes;
  const unread = unreadStops.map((tab) => `- Opened but never read: ${markdownLink(tab)}`).join('\n');
  const section = fieldNotes.lastIndexOf(LOOSE_ENDS);
  if (section < 0) return `${fieldNotes.trimEnd()}\n\n${LOOSE_ENDS}${unread}\n`;
  const start = section + LOOSE_ENDS.length;
  const ends = fieldNotes.slice(start);
  return `${fieldNotes.slice(0, start)}${unread}\n${ends === '- Nothing left open.\n' ? '' : ends}`;
}
