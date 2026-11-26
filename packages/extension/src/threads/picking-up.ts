import type { Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { cosine } from '../embeddings/embedder';
import { displayFieldNotes } from '../wrapup/markdown';
import { readDormantThreads, readThreadMembers, sessionEnd } from './model';

const DAY_MS = 86_400_000;

// The root only has a Query or title embedding, not the richer signature used at wrap-up.
// A plausible match is enough to show context, but does not attach the Expedition.
const ROOT_THREAD_SIMILARITY = 0.72;

export function detectDormantThread(db: TrailmapDb, root: Visit) {
  return db.transaction('r', db.threads, db.expeditions, db.visits, async () => {
    if (root.privacyBlocked) return;
    const threads = await readDormantThreads(db, root.startedAt);
    if (!threads.length) return;
    const readSessions = new Set((root.transition === 'search' ? [] : await db.visits.where('canonicalUrl')
      .equals(root.canonicalUrl).filter((visit) => isPriorRead(visit, root.startedAt)).toArray())
      .map(({ expeditionId }) => expeditionId));
    const exactThreads = new Set((await db.expeditions.bulkGet([...readSessions].filter((id) => id !== null)))
      .flatMap((expedition) => expedition?.threadId && expedition.kind === 'learning' && expedition.endedAt !== null
        ? [expedition.threadId] : []));
    const ranked = threads.map((thread) => ({
      thread, exact: exactThreads.has(thread.id),
      score: root.expeditionEmbedding && thread.centroid ? cosine(root.expeditionEmbedding, thread.centroid) : 0,
    })).filter(({ exact, score }) => exact || score >= ROOT_THREAD_SIMILARITY)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score ||
        b.thread.lastActiveAt - a.thread.lastActiveAt || a.thread.id.localeCompare(b.thread.id));
    for (const { thread } of ranked) {
      const members = await readThreadMembers(db, thread.id);
      const lastSession = members.reduce<typeof members[number] | undefined>((latest, member) =>
        !latest || sessionEnd(member) >= sessionEnd(latest) ? member : latest, undefined);
      if (lastSession) return { thread, members, lastSession };
    }
  });
}

export type PriorRead = { at: number; summary: string | null };

/** Read a live projection without persisting a second copy of a Thread or its Pages. */
export function readPickingUp(db: TrailmapDb, expeditionId: string) {
  return db.transaction('r', [db.threads, db.expeditions, db.visits, db.pages], async () => {
    const expedition = await db.expeditions.get(expeditionId);
    if (expedition?.endedAt !== null || expedition.kind !== 'learning' || !expedition.rootVisitId) return;
    const root = await db.visits.get(expedition.rootVisitId);
    if (root?.expeditionId !== expeditionId) return;
    const match = await detectDormantThread(db, root);
    if (!match) return;
    const { thread, members, lastSession } = match;
    const visits = await db.visits.where('expeditionId').equals(expeditionId).filter((visit) => !visit.privacyBlocked).toArray();
    const urls = [...new Set(visits.map(({ canonicalUrl }) => canonicalUrl))];
    const memberIds = new Set(members.map(({ id }) => id));
    const lastRead = new Map<string, number>();
    await db.visits.where('canonicalUrl').anyOf(urls).filter((visit) =>
      isPriorRead(visit, root.startedAt) && visit.expeditionId !== null && memberIds.has(visit.expeditionId),
    ).each(({ canonicalUrl, startedAt }) => {
      if (startedAt > (lastRead.get(canonicalUrl) ?? -Infinity)) lastRead.set(canonicalUrl, startedAt);
    });
    const pages = await db.pages.bulkGet([...lastRead.keys()]);
    const byUrl = new Map(pages.flatMap((page) => page ? [[page.canonicalUrl, page] as const] : []));
    const priorReads = new Map<string, PriorRead>();
    for (const visit of visits) {
      const at = lastRead.get(visit.canonicalUrl);
      if (at === undefined) continue;
      const page = byUrl.get(visit.canonicalUrl);
      const summary = page?.enrichedAt != null && page.enrichedAt < root.startedAt ? page.summary : null;
      priorReads.set(visit.id, { at, summary });
    }
    const notes = displayFieldNotes(lastSession)?.trim() ?? '';
    const summary = fieldNotesSection(notes, 'What you found');
    const looseEnds = fieldNotesSection(notes, 'Loose ends');
    return {
      thread, days: Math.floor((root.startedAt - thread.lastActiveAt) / DAY_MS),
      summary: summary ?? (looseEnds === undefined ? notes : ''), looseEnds, priorReads,
    };
  });
}

function fieldNotesSection(notes: string, title: string) {
  const lines = notes.split(/\r?\n/);
  const heading = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/;
  const start = lines.findIndex((line) => heading.exec(line)?.[2] === title);
  if (start === -1) return;
  const depth = heading.exec(lines[start]!)![1]!.length;
  let end = start + 1;
  while (end < lines.length && (heading.exec(lines[end]!)?.[1]?.length ?? Infinity) > depth) end++;
  return lines.slice(start + 1, end).join('\n').trim();
}

function isPriorRead(visit: Visit, before: number) {
  return visit.engagement === 'read' && !visit.privacyBlocked && visit.startedAt < before;
}
