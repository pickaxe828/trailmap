import { canonicalizeUrl } from '../capture/canonical';
import { renderConceptNote } from '../concepts/note';
import { readConceptEvidenceBatch, readVisibleConcepts } from '../concepts/read';
import type { TrailmapDb } from '../db/db';
import { frontmatter, notePath, renderExpeditionNote, type MarkdownNote, type NoteLink } from './notes';

const append = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
};

function exportUrl(raw: string): string | undefined {
  const url = URL.parse(raw);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
  return canonicalizeUrl(url.href);
}

/** The vault and ZIP share this projection. Observe its source tables from the background, not model job hooks. */
export async function readMarkdownNotes(db: TrailmapDb): Promise<MarkdownNote[]> {
  const { expeditions, visits, notes, concepts, evidence } = await db.transaction('r',
    [db.expeditions, db.visits, db.concepts, db.conceptEvidence, db.pages, db.notes], async () => {
      const [expeditions, visits, notes, concepts] = await Promise.all([
        db.expeditions.toArray(), db.visits.toArray(), db.notes.toArray(), readVisibleConcepts(db),
      ]);
      const evidence = await readConceptEvidenceBatch(db, concepts.map(({ id }) => id));
      return { expeditions, visits, notes, concepts, evidence };
    });
  const urls = new Map<string, string[]>();
  const manual = new Map<string, string[]>();
  const links = new Map<string, NoteLink[]>();
  for (const visit of visits) {
    if (!visit.expeditionId || visit.privacyBlocked) continue;
    const url = exportUrl(visit.canonicalUrl);
    if (url) append(urls, visit.expeditionId, url);
  }
  for (const note of notes) append(manual, note.nodeId, note.text);
  const projectedConcepts = await Promise.all(concepts.map(async (concept) => {
    const path = await notePath('concept', concept.id);
    const sources = (evidence.get(concept.id) ?? []).flatMap(({ page, visits }) => {
      const canonicalUrl = exportUrl(page.canonicalUrl);
      const eligible = visits.filter(({ visit }) => !visit.privacyBlocked);
      return canonicalUrl && eligible.length ? [{ page: { ...page, canonicalUrl }, visits: eligible }] : [];
    });
    const metadata = frontmatter({ title: concept.name, aliases: [concept.name, ...concept.aliases],
      kind: concept.kind, firstSeen: new Date(concept.firstSeen).toISOString() });
    return {
      path, title: concept.name, markdown: `${metadata}\n${renderConceptNote(concept, sources)}`,
      expeditionIds: new Set(sources.flatMap(({ visits }) => visits.flatMap(({ visit }) => visit.expeditionId ?? []))),
    };
  }));
  const conceptNotes = projectedConcepts.map(({ expeditionIds, ...note }) => {
    for (const expeditionId of expeditionIds) append(links, expeditionId, note);
    return note;
  });
  const expeditionNotes = await Promise.all(expeditions.map(async (expedition) => ({
    path: await notePath('expedition', expedition.id),
    title: expedition.title,
    markdown: renderExpeditionNote(expedition, urls.get(expedition.id) ?? [], links.get(expedition.id) ?? [], manual.get(expedition.id)),
  })));
  return [...conceptNotes, ...expeditionNotes];
}

/** Dump IndexedDB (not extension preferences or companion credentials), representing vectors as arrays. */
export async function exportJson(db: TrailmapDb): Promise<string> {
  const tables = await db.transaction('r', db.tables, async () => Object.fromEntries(await Promise.all(
    db.tables.map(async (table) => [table.name, table.name === 'visits'
      ? (await db.visits.toArray()).map((visit) => ({ ...visit, url: exportUrl(visit.url) ?? visit.canonicalUrl }))
      : await table.toArray()]),
  )));
  return JSON.stringify({ schemaVersion: db.verno, tables }, (_key, value) =>
    value instanceof Int8Array ? Array.from(value) : value, 2);
}
