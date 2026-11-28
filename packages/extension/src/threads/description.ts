import type { Expedition } from '@trailmap/shared';

/** Per-part limits, so MiniLM's 256-token window is never spent on one part alone. */
export const MY_NOTES_CHARS = 600;
export const FOUND_CHARS = 400;

export type DescriptionParts = Pick<Expedition, 'title' | 'drivingQuestion' | 'myNotes' | 'fieldNotes'> & { concepts: readonly string[] };

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The generated "What you found" paragraph: the field notes' own summary, without links or section headings. */
export function foundSummary(fieldNotes: string | null | undefined): string {
  if (!fieldNotes) return '';
  const section = /^## What you found\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(fieldNotes)?.[1] ?? '';
  return oneLine(section.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).slice(0, FOUND_CHARS);
}

/**
 * What an Expedition is about, for matching (PLAN §4.7), most trusted first: the title and question,
 * the user's own notes (only when the setting allows), the top concepts, then the generated summary.
 * It stays local: the text is embedded on the device and never sent to a model.
 */
export function buildDescription(parts: DescriptionParts, useMyNotes: boolean): string {
  const mine = useMyNotes && parts.myNotes ? oneLine(parts.myNotes).slice(0, MY_NOTES_CHARS) : '';
  return [parts.title, parts.drivingQuestion, mine, ...parts.concepts, foundSummary(parts.fieldNotes)]
    .filter(Boolean).join('\n');
}
