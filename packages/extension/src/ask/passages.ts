import type { Expedition, Visit } from '@trailmap/shared';
import { cap } from '../enrichment/input';
import { readAtlas } from '../atlas/data';
import type { TrailmapDb } from '../db/db';
import { eligibleMetadata, maySendToModel, usesMyNotes, type RecordingSettings } from '../privacy/policy';
import { allowsSources, modelSources } from '../privacy/sources';
import { webUrl } from '../ui/web-url';
import type { AskCitation } from './messages';

export const MAX_PASSAGES = 6;
const SENDABLE_PREFIXES = new Set(['page', 'field-notes', 'my-notes', 'manual-note', 'concept']);
const PASSAGE_BYTES = 3_000;
const CHUNK_CHARS = 600;
const STOPWORDS = new Set(('the and for are but not you all any can had her was one our out has have this that with from they been what when where which who whom whose why how ' +
  'does did doing about into over than then them these those there their would could should will shall your yours mine its it\'s is am be as at by do he if in me my no of on or so to up us we an a i').split(' '));

export type AskPassage = { ref: string; kind: 'page' | 'field notes' | 'my notes' | 'concept'; title: string; text: string; citation: AskCitation };
type Found = Omit<AskPassage, 'ref'> & { visitIds: string[]; canonicalUrls: string[]; expeditionIds: string[] };
export type AskInput = { input: string; passages: AskPassage[]; visitIds: string[]; canonicalUrls: string[]; expeditionIds: string[] };

/** Every table `readAskInput` reads: list them all in the transaction and in the model request's guard. */
export const askTables = (db: TrailmapDb) => [db.visits, db.pages, db.queries, db.expeditions, db.notes, db.concepts, db.conceptEvidence,
  db.highlights, db.dismissedConcepts, db.edges, db.threads];

const stem = (word: string) => word.replace(/(ing|ed|es|s)$/, '');
export function significantTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 2 && !STOPWORDS.has(word)).map(stem).filter((word) => word.length > 1))];
}

/** The chunks of `text` that share the most terms with the question, in their original order. */
function excerpt(text: string, terms: string[], bytes = PASSAGE_BYTES): string {
  const chunks = text.replace(/\r/g, '').split(/\n\s*\n|\n/).flatMap((block) => {
    const pieces: string[] = [];
    for (let at = 0; at < block.length; at += CHUNK_CHARS) pieces.push(block.slice(at, at + CHUNK_CHARS));
    return pieces;
  }).map((chunk) => chunk.trim()).filter(Boolean);
  const scored = chunks.map((chunk, index) => {
    const folded = chunk.toLowerCase();
    return { chunk, index, score: terms.filter((term) => folded.includes(term)).length };
  });
  const chosen: typeof scored = [];
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (!item.score && chosen.length) break;
    if (used + item.chunk.length > bytes && chosen.length) continue;
    chosen.push(item);
    used += item.chunk.length;
  }
  return cap(chosen.sort((a, b) => a.index - b.index).map(({ chunk }) => chunk).join('\n'), bytes);
}

const mentions = (terms: string[], ...texts: string[]) => {
  const folded = texts.join('\n').toLowerCase();
  return terms.some((term) => folded.includes(term));
};
const expeditionCitation = (expedition: Expedition): AskCitation =>
  ({ kind: 'expedition', id: expedition.id, title: expedition.title, href: `/expedition.html?${new URLSearchParams({ id: expedition.id })}` });

/**
 * Reads one ranked search document from the *current* database and returns it only if it may go to a model right now.
 * The ranking index is just a ranking: nothing here comes from it, so content forgotten, skipped or paused since it was
 * indexed is never read.
 */
async function readPassage(db: TrailmapDb, id: string, settings: RecordingSettings, terms: string[]): Promise<Found | undefined> {
  const [prefix, ...rest] = id.split(':');
  const key = rest.join(':');
  const notesOk = !settings.paused && usesMyNotes(settings);
  if (prefix === 'page') {
    const page = await db.pages.get(key);
    if (!page?.text.trim()) return;
    const [visits, source] = await Promise.all([db.visits.where('canonicalUrl').equals(key).toArray(),
      page.sourceVisitId ? db.visits.get(page.sourceVisitId) : undefined]);
    const visit = visits.sort((a, b) => b.startedAt - a.startedAt).find((candidate) => maySendToModel(candidate, page, settings, source));
    if (!visit) return;
    const expedition = visit.aiConversation && visit.expeditionId ? await db.expeditions.get(visit.expeditionId) : undefined;
    const web = webUrl(page.canonicalUrl);
    const title = visit.title || web?.hostname || 'Conversation';
    const text = excerpt(page.text, terms);
    if (!mentions(terms, title, text)) return;
    return { kind: 'page', title, text, visitIds: [visit.id, ...(source ? [source.id] : [])], canonicalUrls: [visit.url, visit.canonicalUrl, ...(page.sourceUrl ? [page.sourceUrl] : [])],
      expeditionIds: [], citation: visit.aiConversation
        ? (expedition ? expeditionCitation(expedition) : { kind: 'page', id: page.canonicalUrl, title }) // A conversation has no address to link.
        : { kind: 'page', id: page.canonicalUrl, title, href: web?.href } };
  }
  if (prefix === 'field-notes') {
    const expedition = await db.expeditions.get(key);
    const provenance = expedition?.notesSource;
    if (!expedition?.fieldNotes?.trim() || !provenance || settings.paused) return;
    const visits = (await db.visits.bulkGet(provenance.visitIds)).flatMap((visit) => visit ? [visit] : []);
    if (visits.length !== provenance.visitIds.length || !allowsSources(provenance, new Map(visits.map((visit) => [visit.id, visit])), settings)) return;
    const text = excerpt(expedition.fieldNotes, terms);
    if (!mentions(terms, expedition.title, text)) return;
    return { kind: 'field notes', title: expedition.title, text, citation: expeditionCitation(expedition),
      ...modelProvenance(visits, provenance.canonicalUrls), expeditionIds: [expedition.id] };
  }
  if (prefix === 'my-notes') {
    const expedition = await db.expeditions.get(key);
    if (!notesOk || !expedition?.myNotes?.trim()) return;
    const text = excerpt(expedition.myNotes, terms);
    if (!mentions(terms, expedition.title, text)) return;
    return { kind: 'my notes', title: expedition.title, text, citation: expeditionCitation(expedition), visitIds: [], canonicalUrls: [], expeditionIds: [expedition.id] };
  }
  if (prefix === 'manual-note') {
    const note = await db.notes.get(key);
    if (!notesOk || !note?.text.trim()) return;
    const query = await db.queries.get(note.nodeId);
    const visit = await db.visits.get(query?.visitId ?? note.nodeId);
    if (!eligibleMetadata(visit, settings)) return;
    const expedition = visit.expeditionId ? await db.expeditions.get(visit.expeditionId) : undefined;
    const title = expedition?.title ?? visit.title;
    const text = excerpt(note.text, terms);
    if (!mentions(terms, title, text)) return;
    return { kind: 'my notes', title, text, visitIds: [visit.id], canonicalUrls: [visit.url, visit.canonicalUrl], expeditionIds: expedition ? [expedition.id] : [],
      citation: expedition ? expeditionCitation(expedition) : { kind: 'page', id: visit.canonicalUrl, title, href: webUrl(visit.canonicalUrl)?.href } };
  }
  if (prefix === 'concept') return readConcept(db, key, settings, terms, notesOk);
}

export const modelProvenance = (visits: Visit[], extraUrls: string[] = []) => {
  const { visitIds, canonicalUrls } = modelSources(visits);
  return { visitIds, canonicalUrls: [...new Set([...canonicalUrls, ...extraUrls])] };
};

/**
 * Every piece of evidence behind a Concept, if all of it may go to a model now. A Concept's gloss was written by a model from
 * that evidence, so one blocked row hides the Concept. Call inside a read transaction over `askTables`.
 */
export async function readConceptSources(db: TrailmapDb, conceptId: string, settings: RecordingSettings, notesOk: boolean):
  Promise<{ visits: Visit[]; expeditionIds: string[]; citation: AskCitation } | undefined> {
  const rows = await db.conceptEvidence.where('conceptId').equals(conceptId).toArray();
  const visits: Visit[] = [];
  const expeditionIds = new Set<string>();
  let citation: AskCitation | undefined;
  for (const row of rows) {
    if (row.role === 'learned' && row.visitId === row.expeditionId) {
      const expedition = row.expeditionId ? await db.expeditions.get(row.expeditionId) : undefined;
      if (!notesOk || !expedition) return;
      expeditionIds.add(expedition.id);
      citation ??= expeditionCitation(expedition);
      continue;
    }
    const visit = await db.visits.get(row.visitId);
    if (row.role === 'learned') {
      if (!notesOk || !eligibleMetadata(visit, settings)) return;
    } else {
      const page = await db.pages.get(row.canonicalUrl);
      const source = page?.sourceVisitId ? await db.visits.get(page.sourceVisitId) : undefined;
      if (!visit || !maySendToModel(visit, page, settings, source)) return;
    }
    if (!visit) return;
    visits.push(visit);
    const expedition = visit.expeditionId ? await db.expeditions.get(visit.expeditionId) : undefined;
    if (expedition) expeditionIds.add(expedition.id);
    citation ??= expedition ? expeditionCitation(expedition)
      : { kind: 'page', id: visit.canonicalUrl, title: visit.title, href: webUrl(visit.canonicalUrl)?.href };
  }
  if (!citation) return;
  return { visits, expeditionIds: [...expeditionIds], citation };
}

async function readConcept(db: TrailmapDb, conceptId: string, settings: RecordingSettings, terms: string[], notesOk: boolean): Promise<Found | undefined> {
  if (settings.paused) return;
  const concept = (await readAtlas(db)).concepts.find(({ id }) => id === conceptId);
  if (!concept || !mentions(terms, concept.name, concept.gloss, ...concept.aliases)) return;
  const sources = await readConceptSources(db, conceptId, settings, notesOk);
  if (!sources) return;
  return { kind: 'concept', title: concept.name, text: cap(`${concept.name}: ${concept.gloss}`, 800), citation: sources.citation,
    ...modelProvenance(sources.visits), expeditionIds: sources.expeditionIds };
}

/**
 * The one model request for a question: up to `MAX_PASSAGES` passages, taken in ranked order from the current database,
 * each one allowed to go to a model now and sharing a word with the question. `undefined` means there is nothing to send.
 */
export async function readAskInput(db: TrailmapDb, question: string, rankedIds: readonly string[], settings: RecordingSettings): Promise<AskInput | undefined> {
  const terms = significantTerms(question);
  if (!terms.length || settings.paused) return;
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const id of rankedIds) {
    if (found.length >= MAX_PASSAGES) break;
    // Not awaited: a gap with no database request would let the transaction commit under the next read.
    if (!SENDABLE_PREFIXES.has(id.slice(0, id.indexOf(':')))) continue;
    const passage = await readPassage(db, id, settings, terms);
    if (!passage) continue;
    const identity = `${passage.kind}:${passage.citation.kind}:${passage.citation.id}:${passage.text}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    found.push(passage);
  }
  if (!found.length) return;
  const passages = found.map(({ visitIds: _v, canonicalUrls: _u, expeditionIds: _e, ...passage }, index): AskPassage => ({ ref: `p${index + 1}`, ...passage }));
  const union = (key: 'visitIds' | 'canonicalUrls' | 'expeditionIds') => [...new Set(found.flatMap((passage) => passage[key]))].sort();
  return {
    input: JSON.stringify({ question: cap(question, 1_200), passages: passages.map(({ ref, kind, title, text }) => ({ ref, kind, title: cap(title, 400), text })) }),
    passages, visitIds: union('visitIds'), canonicalUrls: union('canonicalUrls'), expeditionIds: union('expeditionIds'),
  };
}

