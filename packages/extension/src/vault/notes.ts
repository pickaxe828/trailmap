import type { Expedition, Thread } from '@trailmap/shared';
import { displayFieldNotes } from '../wrapup/markdown';

export type NoteLink = { path: string; title: string };
export type MarkdownNote = NoteLink & { markdown: string };

export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Titles can change; note paths and incoming wikilinks should not. */
export async function notePath(kind: 'expedition' | 'concept' | 'thread' | 'digest', id: string): Promise<string> {
  return `trailmap-${kind}-${await sha256(id)}.md`;
}

export function wikilink({ path, title }: NoteLink): string {
  const label = title.replace(/[\[\]|#^\\\s]/g, ' ').replace(/ +/g, ' ').trim();
  const target = path.replace(/\.md$/, '');
  return label ? `[[${target}|${label}]]` : `[[${target}]]`;
}

export function frontmatter(fields: Record<string, string | string[] | null>): string {
  const lines = Object.entries(fields).map(([key, value]) => {
    const scalar = JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    return `${key}: ${scalar}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

const headingTitle = (title: string) => title.replace(/\s+/g, ' ').trim().replace(/[\\`*_{}\[\]<>#~&]/g, '\\$&');

export function renderThreadNote(thread: Thread, sessions: readonly NoteLink[]): string {
  const metadata = frontmatter({ title: thread.title, aliases: [thread.title], kind: 'thread', question: thread.question,
    lastActiveAt: new Date(thread.lastActiveAt).toISOString() });
  const sections = [`# ${headingTitle(thread.title) || 'Thread'}`, thread.livingNote,
    sessions.length ? `## Sessions\n\n${sessions.map((session) => `- ${wikilink(session)}`).join('\n')}` : ''];
  return `${metadata}\n${sections.flatMap((section) => section?.trimEnd() || []).join('\n\n')}\n`;
}

export function renderExpeditionNote(
  expedition: Expedition, sourceUrls: readonly string[], concepts: readonly NoteLink[], notes: readonly string[] = [],
): string {
  const metadata = frontmatter({
    title: expedition.title,
    question: expedition.drivingQuestion,
    startedAt: new Date(expedition.startedAt).toISOString(),
    endedAt: expedition.endedAt === null ? null : new Date(expedition.endedAt).toISOString(),
    kind: expedition.kind,
    sourceUrls: [...new Set(sourceUrls)],
  });
  const title = headingTitle(expedition.title);
  const sections = [title ? `# ${title}` : '# Expedition',
    expedition.myNotes?.trim() ? `## My notes\n\n${expedition.myNotes.trim()}` : '', displayFieldNotes(expedition),
    notes.length ? `## Notes\n\n${notes.join('\n\n')}` : '',
    concepts.length ? `## Concepts\n\n${concepts.map((concept) => `- ${wikilink(concept)}`).join('\n')}` : ''];
  return `${metadata}\n${sections.flatMap((section) => section?.trimEnd() || []).join('\n\n')}\n`;
}

export type DigestNoteInput = {
  title: string; kind: 'week' | 'recent'; from: number; to: number; summary: string;
  expeditions: (NoteLink & { why: string })[]; threads: (NoteLink & { why: string })[];
  /** A concept has a note of its own only when the user learned or studied it. */
  concepts: { name: string; note?: NoteLink; strength: string }[];
  looseEnds: { text: string; expedition: NoteLink; href?: string }[];
  pickingUp: NoteLink[];
};

/** A weekly digest as an Obsidian note: the model's summary, then wikilinks to the notes it is about. */
export function renderDigestNote(digest: DigestNoteInput): string {
  const metadata = frontmatter({ title: digest.title, aliases: [digest.title], kind: 'digest', period: digest.kind,
    from: new Date(digest.from).toISOString(), to: new Date(digest.to).toISOString() });
  const why = (text: string) => text ? ` — ${text.replace(/\s+/g, ' ').trim()}` : '';
  const list = (heading: string, lines: string[]) => lines.length ? `## ${heading}\n\n${lines.map((line) => `- ${line}`).join('\n')}` : '';
  const sections = [`# ${headingTitle(digest.title)}`, digest.summary.trim(),
    list('Expeditions', digest.expeditions.map((e) => `${wikilink(e)}${why(e.why)}`)),
    list('Threads', digest.threads.map((t) => `${wikilink(t)}${why(t.why)}`)),
    list('New concepts', digest.concepts.map((c) => `${c.note ? wikilink(c.note) : c.name} (${c.strength})`)),
    list('Open loose ends', digest.looseEnds.map((end) => `${end.text.replace(/\s+/g, ' ').trim()} — ${wikilink(end.expedition)}${end.href ? ` ([tab](${end.href.replace(/[()\s]/g, encodeURIComponent)}))` : ''}`)),
    list('Picking up', digest.pickingUp.map(wikilink))];
  return `${metadata}\n${sections.flatMap((section) => section?.trimEnd() || []).join('\n\n')}\n`;
}
