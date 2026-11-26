import type { Expedition, Thread } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { dismissed, mergeSuggestionsByExpedition } from '../journal/suggestions';
import { buildExpeditionTrail } from '../trail/graph';
import { isClosedLearning, readThreadMembers, sessionEnd, threadStatus, THREAD_WINDOW } from './model';

export type ThreadTarget = NonNullable<Expedition['threadSuggestion']> & { title: string };
type ThreadCard = { kind: 'thread'; thread: Thread; members: Expedition[] };
type ExpeditionCard = { kind: 'expedition'; expedition: Expedition; suggestion?: ThreadTarget };

export function readJournalResearch(db: TrailmapDb, at = Date.now()) {
  return db.transaction('r', [db.threads, db.expeditions], async () => {
    const [threads, expeditions] = await Promise.all([db.threads.toArray(), db.expeditions.orderBy('startedAt').reverse().toArray()]);
    const members = new Map<string, Expedition[]>();
    for (const session of expeditions) {
      if (!session.threadId || !isClosedLearning(session)) continue;
      const sessions = members.get(session.threadId) ?? [];
      sessions.push(session);
      members.set(session.threadId, sessions);
    }
    const visible = threads.filter(({ id }) => (members.get(id)?.length ?? 0) >= 2);
    const joined = new Set(visible.map(({ id }) => id));
    const standalone = expeditions.filter(({ threadId, kind }) => kind !== 'errand' && (!threadId || !joined.has(threadId)));
    const expeditionById = new Map(expeditions.map((expedition) => [expedition.id, expedition]));
    const targets: ThreadTarget[] = [
      ...visible.map(({ id, title }) => ({ kind: 'thread' as const, id, title })),
      ...standalone.filter(isClosedLearning).map(({ id, title }) => ({ kind: 'expedition' as const, id, title })),
    ];
    const suggestedIds = new Set([
      ...visible.filter((thread) => thread.status !== 'done' && thread.lastActiveAt >= at - THREAD_WINDOW).map(({ id }) => id),
      ...standalone.filter((session) => !session.threadAutoExcluded && session.fieldNotes && sessionEnd(session) >= at - THREAD_WINDOW).map(({ id }) => id),
    ]);
    const byId = new Map(targets.filter(({ id }) => suggestedIds.has(id)).map((target) => [target.id, target]));
    const items: (ThreadCard | ExpeditionCard)[] = [
      ...visible.map((thread) => ({ kind: 'thread' as const, thread: { ...thread, status: threadStatus(thread, at) }, members: members.get(thread.id)! })),
      ...standalone.map((expedition) => {
        const candidate = expedition.threadSuggestion && byId.get(expedition.threadSuggestion.id);
        const suggestion = candidate && candidate.kind === expedition.threadSuggestion?.kind && isClosedLearning(expedition) &&
          !dismissed(expedition, candidate, candidate.kind === 'expedition' ? expeditionById.get(candidate.id) : undefined) ? candidate : undefined;
        return { kind: 'expedition' as const, expedition, suggestion };
      }),
    ];
    const time = (item: ThreadCard | ExpeditionCard) => item.kind === 'thread' ? item.thread.lastActiveAt : sessionEnd(item.expedition);
    return { items: items.sort((a, b) => time(b) - time(a)), targets: visible, merges: mergeSuggestionsByExpedition(expeditions),
      other: expeditions.filter(({ kind }) => kind === 'errand') };
  });
}

export type Recurrence = { from: string; to: string; pages: string[]; concepts: string[] };

export function readThread(db: TrailmapDb, id: string, at = Date.now()) {
  return db.transaction('r', [db.threads, db.expeditions, db.visits, db.queries, db.conceptEvidence, db.concepts], async () => {
    const thread = await db.threads.get(id);
    if (!thread) return null;
    const members = await readThreadMembers(db, id);
    if (members.length < 2) return null;
    const otherThreads = (await db.threads.orderBy('lastActiveAt').reverse().toArray()).filter((other) => other.id !== id);
    const previousPage = new Map<string, string>();
    const previousConcept = new Map<string, string>();
    const links = new Map<string, Recurrence>();
    const sessions = [];
    for (const expedition of members) {
      const [visits, queries] = await Promise.all([
        db.visits.where('expeditionId').equals(expedition.id).sortBy('startedAt'),
        db.queries.where('expeditionId').equals(expedition.id).toArray(),
      ]);
      const publicVisits = visits.filter(({ privacyBlocked }) => !privacyBlocked);
      const evidence = await db.conceptEvidence.where('visitId').anyOf(publicVisits.map(({ id }) => id)).toArray();
      const concepts = await db.concepts.bulkGet([...new Set(evidence.map(({ conceptId }) => conceptId))]);
      const link = (from: string) => {
        const key = JSON.stringify([from, expedition.id]);
        const entry = links.get(key) ?? { from, to: expedition.id, pages: [], concepts: [] };
        links.set(key, entry);
        return entry;
      };
      for (const [url, title] of new Map(publicVisits.map(({ canonicalUrl, title }) => [canonicalUrl, title]))) {
        const previous = previousPage.get(url);
        if (previous) link(previous).pages.push(title || url);
        previousPage.set(url, expedition.id);
      }
      for (const concept of concepts) {
        if (!concept) continue;
        const previous = previousConcept.get(concept.id);
        if (previous) link(previous).concepts.push(concept.name);
        previousConcept.set(concept.id, expedition.id);
      }
      sessions.push({ expedition, graph: buildExpeditionTrail(visits, queries) });
    }
    return { thread: { ...thread, status: threadStatus(thread, at) }, sessions, recurrences: [...links.values()], otherThreads };
  });
}

export type ThreadReview = NonNullable<Awaited<ReturnType<typeof readThread>>>;
