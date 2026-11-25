import { forgetConceptEvidence, forgetEdgeEvidence } from '../concepts/forget';
import type { TrailmapDb } from '../db/db';
import { enqueuePageEnrichment } from '../enrichment/enqueue';
import { siteKey } from '../privacy/policy';
import { enqueueThreadMatch } from '../threads/match';
import { refreshThread } from '../threads/model';
import { repairExpedition } from './repair';

type ForgetInput = {
  kind: 'forget-page' | 'forget-expedition' | 'forget-site';
  visitIds: string[];
  /** Pages to delete even if no Visit points at them (a Highlight-only Page). */
  pageUrls?: string[];
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
    const visits = (await db.visits.bulkGet(input.visitIds)).filter((v) => v !== undefined);
    const visitIds = visits.map(({ id }) => id);
    const gone = new Set(visitIds);
    const forgottenExpeditions = input.expeditionIds ?? [];

    const queryIds = new Set([
      ...(await db.queries.where('visitId').anyOf(visitIds).primaryKeys()),
      ...(forgottenExpeditions.length ? await db.queries.where('expeditionId').anyOf(forgottenExpeditions).primaryKeys() : []),
    ] as string[]);
    await db.queries.bulkDelete([...queryIds]);
    await db.visits.bulkDelete(visitIds);

    const candidates = new Set([...visits.map((v) => v.canonicalUrl), ...(input.pageUrls ?? [])]);
    const orphans = new Set<string>();
    const survivors = new Set<string>();
    for (const url of candidates) {
      ((await db.visits.where('canonicalUrl').equals(url).count()) ? survivors : orphans).add(url);
    }
    const urls = [...orphans];
    const highlights = new Set([
      ...(await db.highlights.where('visitId').anyOf(visitIds).primaryKeys()),
      ...(await db.highlights.where('canonicalUrl').anyOf(urls).primaryKeys()),
    ] as string[]);
    await db.highlights.bulkDelete([...highlights]);
    const pagesDeleted = await db.pages.where('canonicalUrl').anyOf(urls).delete();

    // Multi-source requests record provenance for each source in the attempt.
    const audit = [...new Set([
      ...await db.sentToModel.where('canonicalUrl').anyOf(urls).primaryKeys(),
      ...await db.sentToModel.filter((row) => (!!row.expeditionId && forgottenExpeditions.includes(row.expeditionId)) ||
        !!row.visitIds?.some((id) => gone.has(id)) ||
        !!row.canonicalUrls?.some((url) => orphans.has(url))).primaryKeys(),
    ])];
    await db.sentToModel.bulkDelete(audit);

    const affected = new Set([...forgottenExpeditions, ...visits.flatMap(({ expeditionId }) => expeditionId ? [expeditionId] : [])]);
    const affectedSessions = await db.expeditions.filter(({ id, notesSource }) => affected.has(id) ||
      !!notesSource?.visitIds.some((id) => gone.has(id)) || !!notesSource?.canonicalUrls.some((url) => orphans.has(url))).toArray();
    for (const { id } of affectedSessions) affected.add(id);
    const threadIds = new Set(affectedSessions.flatMap(({ threadId }) => threadId ? [threadId] : []));
    const jobs = await db.jobs.filter(({ kind, payload }) => 'canonicalUrl' in payload
      ? orphans.has(payload.canonicalUrl) || gone.has(payload.visitId)
      : 'expeditionId' in payload && (forgottenExpeditions.includes(payload.expeditionId) ||
        (kind === 'thread_match' && affected.has(payload.expeditionId)))).primaryKeys();
    await db.jobs.bulkDelete(jobs);
    let replacedJobs = 0;
    for (const url of survivors) {
      const page = await db.pages.get(url);
      if (!page) continue;
      const remaining = (await db.visits.where('canonicalUrl').equals(url).sortBy('startedAt')).reverse();
      const replacement = remaining[0]!;
      const changes: Partial<typeof page> = {};
      const enrichmentSource = page.enrichmentSourceVisitId ?? page.sourceVisitId;
      const sourceGone = !!page.sourceVisitId && gone.has(page.sourceVisitId);
      if (sourceGone) changes.sourceVisitId = replacement.id;
      if ((page.enrichmentVisitId && gone.has(page.enrichmentVisitId)) || (enrichmentSource && gone.has(enrichmentSource))) {
        // Another Visit to the same Page doesn't retroactively supply the old inference.
        Object.assign(changes, {
          enrichedAt: null, summary: null, takeaways: [], pageKind: null, answersQuestion: undefined,
          enrichmentVisitId: undefined, enrichmentSourceVisitId: undefined, enrichmentSourceUrl: undefined,
          conceptMentions: undefined, relationMentions: undefined,
        } satisfies Partial<typeof page>);
      }
      if (sourceGone || changes.enrichedAt === null) {
        replacedJobs += await db.jobs.filter(({ kind, payload }) => 'canonicalUrl' in payload && payload.canonicalUrl === url &&
          (kind === 'page_enrichment' || changes.enrichedAt === null)).delete();
      }
      if (Object.keys(changes).length) await db.pages.update(url, changes);
      const engaged = remaining.find((v) => v.engagement !== 'bounced' && !v.privacyBlocked);
      if (engaged) await enqueuePageEnrichment(db, engaged, now(), { ...page, ...changes });
    }

    const { removedConceptIds, changedConceptIds, removedJobs, evidenceVisits } = await forgetConceptEvidence(db, gone, urls, now());
    const nodeIds = new Set([...visitIds, ...queryIds, ...forgottenExpeditions, ...urls, ...removedConceptIds]);
    const notes = await db.notes.where('nodeId').anyOf([...nodeIds]).primaryKeys();
    await db.notes.bulkDelete(notes);

    const edgesTouched = await forgetEdgeEvidence(db, nodeIds, gone, evidenceVisits);

    for (const id of forgottenExpeditions) {
      await db.expeditions.delete(id);
      await db.notes.where('nodeId').equals(id).delete();
    }
    if (forgottenExpeditions.length) {
      // A merge suggestion's reason was written from the forgotten Expedition's content.
      await db.expeditions.filter(({ mergeSuggestions }) =>
        !!mergeSuggestions?.some(({ expeditionId }) => forgottenExpeditions.includes(expeditionId)))
        .modify((expedition) => { delete expedition.mergeSuggestions; });
    }
    for (const id of affected) {
      if (!forgottenExpeditions.includes(id)) await repairExpedition(db, id, { derivedContentRemoved: true });
    }
    const invalidSignatures = await db.expeditions.filter(({ id, threadSignature }) => affected.has(id) ||
      !!threadSignature?.conceptIds.some((conceptId) => changedConceptIds.has(conceptId))).toArray();
    for (const session of invalidSignatures) {
      const { id, threadId } = session;
      await db.expeditions.update(id, { threadSignature: undefined, threadSuggestion: undefined });
      if (threadId) threadIds.add(threadId);
    }
    for (const id of threadIds) {
      await refreshThread(db, id, now(), true);
      if (!await db.threads.get(id)) await db.notes.where('nodeId').equals(id).delete();
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

    const logIds = [...new Set([...nodeIds, ...threadIds, ...(input.targetIds ?? [])])];
    const logged = await db.corrections.where('targetIds').anyOf(logIds).primaryKeys();
    await db.corrections.bulkDelete([...new Set(logged)]);

    if (audit.length) {
      await db.sentToModel.add({
        id: newId(), at: now(), task: 'forgotten', provider: 'trailmap', model: 'none', input: [],
        instructions: `${audit.length} ${audit.length === 1 ? 'entry' : 'entries'} about forgotten items ${audit.length === 1 ? 'was' : 'were'} removed from this log. Their content was deleted.`,
      });
    }
    await db.corrections.add({
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
