import type { Visit } from '@trailmap/shared';
import { conceptNameKey, type ConceptEvidence } from '../concepts/evidence';
import type { TrailmapDb } from '../db/db';

export const SNIPPET_CHARS = 240;

/** Where a snippet came from, for the line under it. */
export type SnippetSource = {
  kind: 'my-notes' | 'note' | 'highlight' | 'page';
  title: string;
  /** A web address for a page; an Expedition for notes. */
  url?: string;
  expeditionId?: string;
  aiGenerated?: boolean;
};
export type Snippet = { text: string; source: SnippetSource };

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const boundary = /[.!?。\n]/;

/** The sentence of `text` that names the concept, trimmed around the name when it runs long. */
export function extractSnippet(text: string, names: readonly string[], max = SNIPPET_CHARS): string | undefined {
  const haystack = text.normalize('NFKC');
  const lower = haystack.toLowerCase();
  let at = -1;
  let length = 0;
  for (const name of names.map((name) => conceptNameKey(name)).filter(Boolean)) {
    const found = lower.indexOf(name);
    if (found >= 0 && (at < 0 || found < at)) { at = found; length = name.length; }
  }
  if (at < 0) return;
  let start = at;
  while (start > 0 && !boundary.test(haystack[start - 1]!)) start--;
  let end = at + length;
  while (end < haystack.length && !boundary.test(haystack[end]!)) end++;
  if (end < haystack.length && haystack[end] !== '\n') end++;
  let sentence = clean(haystack.slice(start, end));
  if (sentence.length > max) {
    const within = Math.max(0, at - start - Math.floor((max - length) / 2));
    sentence = `${within > 0 ? '…' : ''}${clean(haystack.slice(start + within, start + within + max))}…`;
  }
  return sentence || undefined;
}

const cap = (text: string, max = SNIPPET_CHARS) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * One piece of evidence still on screen for a Concept: the user's own notes first, then a highlight, then the sentence on a Page
 * that names it (or the Page's summary). Only evidence the user can still see counts: the Visit and Page exist, the Visit was not
 * a private page and its Expedition is not an errand. Call inside a read transaction over `reviewTables`.
 */
export async function readEvidenceSnippet(db: TrailmapDb, conceptId: string): Promise<Snippet | undefined> {
  const concept = await db.concepts.get(conceptId);
  if (!concept) return;
  const names = [concept.name, ...concept.aliases];
  const rows = (await db.conceptEvidence.where('conceptId').equals(conceptId).toArray())
    .sort((a, b) => Number(b.role === 'learned') - Number(a.role === 'learned') || b.startedAt - a.startedAt);
  for (const row of rows) {
    const found = row.role === 'learned' ? await fromNotes(db, row, names) : await fromPage(db, row, names);
    if (found) return found;
  }
}

async function fromNotes(db: TrailmapDb, row: ConceptEvidence, names: string[]): Promise<Snippet | undefined> {
  const expedition = row.expeditionId ? await db.expeditions.get(row.expeditionId) : undefined;
  if (!expedition || expedition.kind === 'errand') return;
  const mine = row.visitId === row.expeditionId;
  const text = mine ? expedition.myNotes : (await db.notes.where('nodeId').equals(row.visitId).toArray()).map(({ text }) => text).join('\n');
  const snippet = text && extractSnippet(text, names);
  return snippet ? { text: snippet, source: { kind: mine ? 'my-notes' : 'note', title: expedition.title, expeditionId: expedition.id } } : undefined;
}

async function fromPage(db: TrailmapDb, row: ConceptEvidence, names: string[]): Promise<Snippet | undefined> {
  const visit: Visit | undefined = await db.visits.get(row.visitId);
  if (!visit || visit.privacyBlocked) return;
  const [page, expedition] = await Promise.all([db.pages.get(row.canonicalUrl), visit.expeditionId ? db.expeditions.get(visit.expeditionId) : undefined]);
  if (!page || expedition?.kind === 'errand') return;
  const source = (kind: 'highlight' | 'page'): SnippetSource => ({ kind, title: visit.title || page.canonicalUrl, url: visit.canonicalUrl,
    ...(visit.aiConversation ? { aiGenerated: true } : {}) });
  for (const { text } of await db.highlights.where('visitId').equals(visit.id).toArray()) {
    const snippet = extractSnippet(text, names);
    if (snippet) return { text: snippet, source: source('highlight') };
  }
  const sentence = extractSnippet(page.text, names);
  if (sentence) return { text: sentence, source: source('page') };
  return page.summary ? { text: cap(clean(page.summary)), source: source('page') } : undefined;
}
