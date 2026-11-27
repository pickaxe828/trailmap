import { liveQuery } from 'dexie';
import type { Visit } from '@trailmap/shared';
import { readAtlas } from '../atlas/data';
import type { TrailmapDb } from '../db/db';
import { webUrl } from '../ui/web-url';
import type { SearchDocument } from './index';

const semanticText = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n').slice(0, 1_200);
const reviewPath = (page: 'atlas' | 'expedition' | 'thread', key: 'id' | 'concept', id: string) =>
  `/${page}.html?${new URLSearchParams({ [key]: id })}`;

/** Project the local sources, rather than persisting a second copy of captured or generated text. */
export function observeSearchCorpus(db: TrailmapDb) {
  return liveQuery(() => db.transaction('r', [db.visits, db.pages, db.queries, db.expeditions, db.threads, db.concepts, db.conceptEvidence, db.edges, db.notes], async () => {
    const [visits, pages, queries, expeditions, threads, { concepts }, notes] = await Promise.all([
      db.visits.toArray(), db.pages.toArray(), db.queries.toArray(), db.expeditions.toArray(), db.threads.toArray(), readAtlas(db), db.notes.toArray(),
    ]);
    const blocked = new Set(visits.filter(({ privacyBlocked }) => privacyBlocked).map(({ id }) => id));
    const latest = new Map<string, Visit>();
    for (const visit of visits) {
      if (!visit.privacyBlocked && visit.title && (latest.get(visit.canonicalUrl)?.startedAt ?? -Infinity) < visit.startedAt) {
        latest.set(visit.canonicalUrl, visit);
      }
    }

    const documents: SearchDocument[] = [];
    const noteTargets = new Map<string, { title: string; href: string }>();
    const expeditionIds = new Set(expeditions.map(({ id }) => id));
    for (const visit of visits) {
      const url = webUrl(visit.url);
      if (visit.privacyBlocked || !url) continue;
      noteTargets.set(visit.id, { title: visit.title || url.hostname, href: visit.expeditionId && expeditionIds.has(visit.expeditionId)
        ? reviewPath('expedition', 'id', visit.expeditionId) : url.href });
    }
    for (const query of queries) {
      const target = query.visitId ? noteTargets.get(query.visitId) : undefined;
      if (target) noteTargets.set(query.id, { ...target, title: query.q });
    }
    for (const page of pages) {
      const url = webUrl(page.canonicalUrl);
      if (!url) continue;
      const textAllowed = !page.sourceVisitId || !blocked.has(page.sourceVisitId);
      const notesAllowed = textAllowed && ![page.enrichmentVisitId, page.enrichmentSourceVisitId].some((id) => id && blocked.has(id));
      const text = textAllowed ? page.text : '';
      const summary = notesAllowed ? page.summary : null;
      const takeaways = notesAllowed ? page.takeaways : [];
      const visit = latest.get(page.canonicalUrl);
      if (!visit && !text && !summary) continue;
      const title = visit?.title || url.hostname;
      noteTargets.set(page.canonicalUrl, { title, href: url.href });
      documents.push({
        id: `page:${page.canonicalUrl}`, kind: 'page', title, href: url.href, detail: url.hostname,
        body: [summary, ...takeaways, text].filter(Boolean).join('\n'),
        embedding: notesAllowed ? page.embedding : null, semanticText: semanticText(title, summary, ...takeaways, text),
      });
    }
    for (const concept of concepts) {
      noteTargets.set(concept.id, { title: concept.name, href: reviewPath('atlas', 'concept', concept.id) });
      documents.push({
        id: `concept:${concept.id}`, kind: 'concept', title: concept.name,
        href: reviewPath('atlas', 'concept', concept.id), detail: 'Atlas',
        body: [concept.gloss, ...concept.aliases].join('\n'), embedding: concept.embedding,
        semanticText: semanticText(concept.name, concept.gloss),
      });
    }
    for (const expedition of expeditions) {
      noteTargets.set(expedition.id, { title: expedition.title, href: reviewPath('expedition', 'id', expedition.id) });
      if (expedition.myNotes?.trim()) documents.push({
        id: `my-notes:${expedition.id}`, kind: 'note', title: expedition.title,
        href: reviewPath('expedition', 'id', expedition.id), detail: 'My notes',
        body: expedition.myNotes, semanticText: semanticText(expedition.title, expedition.drivingQuestion, expedition.myNotes),
      });
      if (!expedition.fieldNotes?.trim()) continue;
      documents.push({
        id: `field-notes:${expedition.id}`, kind: 'note', title: expedition.title,
        href: reviewPath('expedition', 'id', expedition.id), detail: 'Field notes',
        body: expedition.fieldNotes, semanticText: semanticText(expedition.title, expedition.drivingQuestion, expedition.fieldNotes),
      });
    }
    for (const thread of threads) {
      noteTargets.set(thread.id, { title: thread.title, href: reviewPath('thread', 'id', thread.id) });
      if (!thread.livingNote?.trim()) continue;
      documents.push({
        id: `living-note:${thread.id}`, kind: 'note', title: thread.title,
        href: reviewPath('thread', 'id', thread.id), detail: 'Living note',
        body: thread.livingNote, semanticText: semanticText(thread.title, thread.question, thread.livingNote),
      });
    }
    for (const note of notes) {
      const target = noteTargets.get(note.nodeId);
      if (!target || !note.text.trim()) continue;
      documents.push({ id: `manual-note:${note.id}`, kind: 'note', ...target, detail: 'Manual note',
        body: note.text, semanticText: semanticText(target.title, note.text) });
    }
    return documents;
  }));
}
