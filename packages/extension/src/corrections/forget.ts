import { forgetConceptEvidence, forgetEdgeEvidence } from '../concepts/forget';
import type { TrailmapDb } from '../db/db';
import { enqueuePageEnrichment } from '../enrichment/enqueue';
import { enqueueNotesEnrichment } from '../notes/enqueue';
import { isDefaultDenied, siteKey } from '../privacy/policy';
import { enqueueThreadMatch } from '../threads/match';
import { refreshThread } from '../threads/model';
import { repairExpedition } from './repair';

type ForgetInput = {
  kind: 'forget-page' | 'forget-expedition' | 'forget-site';
  visitIds?: string[];
  /** Silent startup cleanup should not add empty correction records. */
  quiet?: boolean;
  /** Pages to delete even if no Visit points at them (a Highlight-only Page). */
  pageUrls?: string[];
  /** A site Forget also removes captures and derived data identified by source URL. */
  host?: string;
  /** Upgrade cleanup for previously persisted deny-list and password records. */
  denied?: boolean;
  /** Expeditions that must not survive, even with legacy Queries that have no Visit. */
  expeditionIds?: string[];
  /** Log entries mentioning these ids (besides deleted Visits) go too. */
  targetIds?: string[];
  now: () => number;
  newId: () => string;
};

export type ForgetResult = { visitIds: string[] };

export const hostMatches = (url: string | undefined, host: string) => {
  const key = siteKey(url);
  return !!key && (key === host || key.endsWith(`.${host}`));
};

/**
 * Hard delete (docs/PLAN.md §8). Removes the Visits and everything derived from
 * them in one transaction: Pages that no Visit still points at, Queries,
 * Highlights, Notes, Page jobs, "sent to model" audit rows for those Pages,
 * Edge evidence and the correction-log entries that mention them. The audit log
 * keeps one content-free row saying how many entries were removed, and the
 * correction log gets one entry with counts only. Nothing identifying is retained.
 */
export async function forgetCascade(db: TrailmapDb, input: ForgetInput): Promise<ForgetResult> {
  const { kind, now, newId } = input;
  const tables = [db.visits, db.queries, db.pages, db.highlights, db.notes, db.edges, db.jobs, db.sentToModel,
    db.expeditions, db.corrections, db.concepts, db.conceptEvidence, db.threads];
  return db.transaction('rw', tables, async () => {
    const fromForgottenHost = (url: string | undefined) => !!url && (!!input.host && hostMatches(url, input.host) ||
      !!input.denied && isDefaultDenied(url));
    let visits = input.host || input.denied
      ? await db.visits.filter(({ url, canonicalUrl, privacyBlocked }) => fromForgottenHost(url) || fromForgottenHost(canonicalUrl) ||
        !!input.denied && !!privacyBlocked).toArray()
      : (await db.visits.bulkGet(input.visitIds ?? [])).filter((v) => v !== undefined);
    // The conversation follows its opening search into Forget. A synthetic
    // opening Query is itself part of the conversation (not a separate search).
    const linked = new Map(visits.map((visit) => [visit.id, visit]));
    const parentIds = visits.flatMap((visit) => visit.aiConversation && visit.parentVisitId ? [visit.parentVisitId] : []);
    for (const parent of await db.visits.bulkGet(parentIds)) {
      if (parent?.aiOpeningQuery) linked.set(parent.id, parent);
    }
    const children = await db.visits.where('parentVisitId').anyOf([...linked.keys()]).filter((visit) => !!visit.aiConversation).toArray();
    for (const child of children) linked.set(child.id, child);
    visits = [...linked.values()];
    const visitIds = [...linked.keys()];
    const gone = new Set(visitIds);
    const forgottenExpeditions = input.expeditionIds ?? [];
    if (input.denied) {
      // Pre-provenance records can identify protected Pages independently of their Visits.
      const hasPrivatePage = !!await db.pages.filter(({ canonicalUrl, sourceUrl, enrichmentSourceUrl }) =>
        [canonicalUrl, sourceUrl, enrichmentSourceUrl].some(fromForgottenHost)).first();
      if (!visits.length && !hasPrivatePage) return { visitIds };
    }

    const queryIds = new Set([
      ...(await db.queries.where('visitId').anyOf(visitIds).primaryKeys()),
      ...(forgottenExpeditions.length ? await db.queries.where('expeditionId').anyOf(forgottenExpeditions).primaryKeys() : []),
    ] as string[]);
    await db.queries.bulkDelete([...queryIds]);
    await db.visits.bulkDelete(visitIds);

    const candidates = new Set(visits.map((v) => v.canonicalUrl));
    const orphans = new Set(input.pageUrls ?? []);
    for (const url of candidates) {
      if (!await db.visits.where('canonicalUrl').equals(url).count()) orphans.add(url);
    }
    const invalidated = new Set<string>();
    const sourceRemoved = (source?: { visitIds: string[]; canonicalUrls: string[] }) => !!source && (
      source.visitIds.some((id) => gone.has(id)) || source.canonicalUrls.some((url) =>
        orphans.has(url) || invalidated.has(url) || fromForgottenHost(url)));
    const pages = await db.pages.toArray();
    for (const page of pages) {
      // A canonical alias is not a substitute for the actual capture.
      if (fromForgottenHost(page.canonicalUrl) || fromForgottenHost(page.sourceUrl) ||
        (page.sourceVisitId ? gone.has(page.sourceVisitId) : candidates.has(page.canonicalUrl))) {
        orphans.add(page.canonicalUrl);
      }
    }
    for (const page of pages) {
      if (orphans.has(page.canonicalUrl)) continue;
      if ((page.enrichmentVisitId && gone.has(page.enrichmentVisitId)) ||
        (page.enrichmentSourceVisitId && gone.has(page.enrichmentSourceVisitId)) ||
        fromForgottenHost(page.enrichmentSourceUrl) || sourceRemoved(page.enrichmentSources)) {
        invalidated.add(page.canonicalUrl);
        await db.pages.update(page.canonicalUrl, {
          enrichedAt: null, summary: null, takeaways: [], pageKind: null, answersQuestion: undefined,
          enrichmentVisitId: undefined, enrichmentSourceVisitId: undefined, enrichmentSourceUrl: undefined, enrichmentSources: undefined,
          conceptMentions: undefined, relationMentions: undefined,
        });
      }
    }
    const urls = [...orphans];
    const highlights = new Set([
      ...(await db.highlights.where('visitId').anyOf(visitIds).primaryKeys()),
      // Allowed alias Highlights belong to their own Visits, not to the removed text capture.
      ...(await db.highlights.where('canonicalUrl').anyOf([...orphans].filter((url) =>
        !candidates.has(url) || fromForgottenHost(url))).primaryKeys()),
    ] as string[]);
    await db.highlights.bulkDelete([...highlights]);
    const pagesDeleted = await db.pages.where('canonicalUrl').anyOf(urls).delete();

    // Multi-source requests record provenance for each source in the attempt.
    const audit = [...new Set([
      ...await db.sentToModel.where('canonicalUrl').anyOf(urls).primaryKeys(),
      ...await db.sentToModel.filter((row) => (!!row.expeditionId && forgottenExpeditions.includes(row.expeditionId)) ||
        !!row.visitIds?.some((id) => gone.has(id)) ||
        !!row.canonicalUrls?.some((url) => orphans.has(url) || invalidated.has(url) || fromForgottenHost(url))).primaryKeys(),
    ])];
    await db.sentToModel.bulkDelete(audit);

    const affected = new Set([...forgottenExpeditions, ...visits.flatMap(({ expeditionId }) => expeditionId ? [expeditionId] : [])]);
    await db.expeditions.filter(({ unreadStops }) => !!unreadStops?.some(({ visitId, url }) =>
      gone.has(visitId) || fromForgottenHost(url))).modify((expedition) => {
      expedition.unreadStops = expedition.unreadStops?.filter(({ visitId, url }) => !gone.has(visitId) && !fromForgottenHost(url));
    });
    const affectedSessions = await db.expeditions.filter(({ id, notesSource, wrapUpSource }) =>
      affected.has(id) || sourceRemoved(notesSource) || sourceRemoved(wrapUpSource)).toArray();
    for (const { id } of affectedSessions) affected.add(id);
    const threadIds = new Set(affectedSessions.flatMap(({ threadId }) => threadId ? [threadId] : []));
    const jobs = await db.jobs.filter(({ kind, payload, status }) => 'canonicalUrl' in payload
      ? orphans.has(payload.canonicalUrl) || invalidated.has(payload.canonicalUrl) || gone.has(payload.visitId)
      : 'expeditionId' in payload && (forgottenExpeditions.includes(payload.expeditionId) ||
        (affected.has(payload.expeditionId) && (kind === 'thread_match' || kind === 'notes_enrichment' ||
          (status === 'leased' && (kind === 'expedition_wrap_up' || kind === 'field_notes')))))).primaryKeys();
    const notesJobs = new Set((await db.jobs.bulkGet(jobs)).flatMap((job) => job?.kind === 'notes_enrichment' && 'expeditionId' in job.payload ? [job.payload.expeditionId] : []));
    await db.jobs.bulkDelete(jobs);
    let replacedJobs = 0;
    for (const url of new Set([...candidates, ...invalidated])) {
      if (orphans.has(url)) continue;
      const page = await db.pages.get(url);
      const remaining = await db.visits.where('canonicalUrl').equals(url).reverse().sortBy('startedAt');
      const engaged = remaining.find((v) => v.engagement !== 'bounced' && !v.privacyBlocked);
      if (engaged && page) await enqueuePageEnrichment(db, engaged, now(), page);
    }

    const { removedConceptIds, changedConceptIds, removedJobs, evidenceVisits, learnedExpeditions } =
      await forgetConceptEvidence(db, gone, [...urls, ...invalidated], now(), sourceRemoved, forgottenExpeditions);
    const nodeIds = new Set([...visitIds, ...queryIds, ...forgottenExpeditions, ...urls, ...removedConceptIds]);
    const notes = await db.notes.where('nodeId').anyOf([...nodeIds]).primaryKeys();
    await db.notes.bulkDelete(notes);

    const edgesTouched = await forgetEdgeEvidence(db, nodeIds, gone, evidenceVisits);

    for (const id of forgottenExpeditions) {
      await db.expeditions.delete(id);
      await db.notes.where('nodeId').equals(id).delete();
    }
    for (const id of affected) {
      if (forgottenExpeditions.includes(id)) continue;
      await repairExpedition(db, id, { derivedContentRemoved: true });
      if (!await db.expeditions.get(id)) nodeIds.add(id);
    }
    // What was learned from a forgotten stop's note is gone; the notes that remain are asked about again.
    for (const id of new Set([...learnedExpeditions, ...notesJobs])) {
      if (!forgottenExpeditions.includes(id) && await db.expeditions.get(id)) await enqueueNotesEnrichment(db, id, now());
    }
    // A suggestion's reason was written from the other Expedition's content too.
    await db.expeditions.filter(({ mergeSuggestions }) =>
      !!mergeSuggestions?.some(({ expeditionId }) => affected.has(expeditionId)))
      .modify(({ mergeSuggestions }, ref) => {
        ref.value.mergeSuggestions = mergeSuggestions?.filter(({ expeditionId }) => !affected.has(expeditionId));
      });
    // A surviving Visit cannot keep a pointer to a forgotten source.
    await db.visits.where('parentVisitId').anyOf(visitIds).modify({ parentVisitId: null });
    const invalidSignatures = await db.expeditions.filter(({ id, threadSignature }) => affected.has(id) ||
      !!threadSignature?.conceptIds.some((conceptId) => changedConceptIds.has(conceptId))).toArray();
    for (const session of invalidSignatures) {
      const { id, threadId } = session;
      await db.expeditions.update(id, { threadSignature: undefined, threadSuggestion: undefined });
      if (threadId) threadIds.add(threadId);
    }
    const survivingThreads = new Set<string>();
    for (const id of threadIds) {
      await refreshThread(db, id, now(), true);
      if (await db.threads.get(id)) survivingThreads.add(id);
      else await db.notes.where('nodeId').equals(id).delete();
    }
    for (const session of invalidSignatures) {
      if (!session.fieldNotes || !session.threadId || !await db.threads.get(session.threadId)) continue;
      replacedJobs += await db.jobs.filter(({ kind, payload }) => kind === 'thread_match' && 'expeditionId' in payload &&
        payload.expeditionId === session.id).delete();
      await enqueueThreadMatch(db, session, now());
    }
    await db.expeditions.filter(({ threadSuggestion: suggestion }) => !!suggestion &&
      (suggestion.kind === 'thread' ? threadIds.has(suggestion.id) : affected.has(suggestion.id)))
      .modify({ threadSuggestion: undefined });

    await db.expeditions.filter(({ dismissedSuggestions }) => !!dismissedSuggestions?.some(({ kind, id }) =>
      kind === 'expedition' ? nodeIds.has(id) : threadIds.has(id) && !survivingThreads.has(id)))
      .modify((session) => {
        session.dismissedSuggestions = session.dismissedSuggestions?.filter(({ kind, id }) => kind === 'expedition'
          ? !nodeIds.has(id) : !threadIds.has(id) || survivingThreads.has(id));
      });
    const logIds = [...new Set([...nodeIds, ...affected, ...threadIds, ...(input.targetIds ?? [])])];
    const logged = await db.corrections.where('targetIds').anyOf(logIds).primaryKeys();
    const undoSources = await db.corrections.filter(({ kind, before }) => {
      if (!kind.startsWith('journal-') || !before || typeof before !== 'object' || !('sourceUrls' in before)) return false;
      const { sourceUrls } = before as { sourceUrls: string[] };
      return sourceUrls.some((url) => orphans.has(url) || invalidated.has(url) || fromForgottenHost(url));
    }).primaryKeys();
    await db.corrections.bulkDelete([...new Set([...logged, ...undoSources])]);

    if (audit.length) {
      await db.sentToModel.add({
        id: newId(), at: now(), task: 'forgotten', provider: 'trailmap', model: 'none', input: [],
        instructions: `${audit.length} ${audit.length === 1 ? 'entry' : 'entries'} about forgotten items ${audit.length === 1 ? 'was' : 'were'} removed from this log. Their content was deleted.`,
      });
    }
    if (!input.quiet) await db.corrections.add({
      id: newId(), at: now(), kind, targetIds: [], after: null,
      before: {
        visits: visitIds.length, pages: pagesDeleted, queries: queryIds.size, highlights: highlights.size,
        notes: notes.length, jobs: jobs.length + replacedJobs + removedJobs, auditRows: audit.length, edges: edgesTouched, concepts: removedConceptIds.length,
        expeditions: forgottenExpeditions.length,
      },
    });
    return { visitIds };
  });
}
