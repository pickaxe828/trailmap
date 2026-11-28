import type { Expedition } from '@trailmap/shared';
import { canonicalizeUrl } from '../capture/canonical';
import { renderConceptNote } from '../concepts/note';
import { readConceptEvidenceBatch, readVisibleConcepts } from '../concepts/read';
import type { TrailmapDb } from '../db/db';
import { digestTitle } from '../digest/title';
import { readLooseEnds } from '../digest/loose-ends';
import { bySessionTime, isClosedLearning } from '../threads/model';
import { frontmatter, notePath, renderDigestNote, renderExpeditionNote, renderThreadNote, type MarkdownNote, type NoteLink } from './notes';

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
  const { expeditions, visits, notes, concepts, evidence, threads, digests, digestConcepts } = await db.transaction('r',
    [db.expeditions, db.visits, db.concepts, db.conceptEvidence, db.pages, db.notes, db.threads, db.highlights, db.dismissedConcepts, db.digests], async () => {
      const [expeditions, visits, notes, concepts, threads] = await Promise.all([
        db.expeditions.toArray(), db.visits.toArray(), db.notes.toArray(), readVisibleConcepts(db), db.threads.toArray(),
      ]);
      const evidence = await readConceptEvidenceBatch(db, concepts.map(({ id }) => id));
      const digests = await db.digests.toArray();
      const digestConcepts = await db.concepts.bulkGet([...new Set(digests.flatMap(({ conceptIds }) => conceptIds))]);
      return { expeditions, visits, notes, concepts, evidence, threads, digests, digestConcepts };
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
  const byExpedition = new Map(expeditions.map(({ id }, i) => [id, expeditionNotes[i]!]));
  const sessionsByThread = new Map<string, Expedition[]>();
  for (const expedition of expeditions) {
    if (expedition.threadId && isClosedLearning(expedition)) append(sessionsByThread, expedition.threadId, expedition);
  }
  const threadNotes = await Promise.all(threads.map(async (thread) => ({
    path: await notePath('thread', thread.id),
    title: thread.title,
    markdown: renderThreadNote(thread, (sessionsByThread.get(thread.id) ?? []).sort(bySessionTime)
      .map(({ id }) => byExpedition.get(id)!)),
  })));
  const conceptNoteById = new Map(concepts.map(({ id }, i) => [id, conceptNotes[i]!]));
  const knownConcepts = new Map(digestConcepts.flatMap((concept) => concept ? [[concept.id, concept] as const] : []));
  const threadNoteById = new Map(threads.map(({ id }, i) => [id, threadNotes[i]!]));
  const expeditionsById = new Map(expeditions.map((expedition) => [expedition.id, expedition]));
  const digestNotes = await Promise.all(digests.map(async (digest) => {
    const title = digestTitle(digest);
    const named = (note: { path: string; title: string } | undefined) => note && { path: note.path, title: note.title };
    return {
      path: await notePath('digest', digest.id), title,
      markdown: renderDigestNote({
        title, kind: digest.kind, from: digest.from, to: digest.to, summary: digest.summary,
        expeditions: digest.expeditions.flatMap(({ id, why }) => byExpedition.has(id) ? [{ ...named(byExpedition.get(id))!, why }] : []),
        threads: digest.threads.flatMap(({ id, why }) => threadNoteById.has(id) ? [{ ...named(threadNoteById.get(id))!, why }] : []),
        concepts: digest.conceptIds.flatMap((id) => knownConcepts.get(id) ? [{ name: knownConcepts.get(id)!.name, note: named(conceptNoteById.get(id)),
          strength: conceptNoteById.has(id) ? 'learned or studied' : 'seen' }] : []),
        looseEnds: digest.expeditionIds.flatMap((id) => {
          const expedition = expeditionsById.get(id);
          const note = named(byExpedition.get(id));
          return expedition && note && expedition.endedAt !== null && expedition.endedAt >= digest.from && expedition.endedAt < digest.to
            ? readLooseEnds(expedition).map(({ text, href }) => ({ text, href: href && exportUrl(href), expedition: note })) : [];
        }),
        pickingUp: digest.pickingUp.flatMap((id) => threadNoteById.has(id) ? [named(threadNoteById.get(id))!] : []),
      }),
    };
  }));
  return [...conceptNotes, ...expeditionNotes, ...threadNotes, ...digestNotes];
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
