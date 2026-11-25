import type { TrailmapDb } from '../db/db';
import { enqueuePageEnrichment } from '../enrichment/enqueue';
import { siteKey } from '../privacy/policy';
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
    db.expeditions, db.corrections];
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

    // Wrap-up and field-notes requests quote several Pages; they carry every canonicalUrl they sent.
    const audit = [...new Set([
      ...await db.sentToModel.where('canonicalUrl').anyOf(urls).primaryKeys(),
      ...await db.sentToModel.filter((row) => (!!row.expeditionId && forgottenExpeditions.includes(row.expeditionId)) ||
        !!row.canonicalUrls?.some((url) => orphans.has(url))).primaryKeys(),
    ])];
    await db.sentToModel.bulkDelete(audit);

    const jobs = await db.jobs.filter(({ kind, payload }) => kind === 'page_enrichment'
      ? orphans.has((payload as { canonicalUrl: string }).canonicalUrl) || gone.has((payload as { visitId: string }).visitId)
      : forgottenExpeditions.includes((payload as { expeditionId: string }).expeditionId)).primaryKeys();
    await db.jobs.bulkDelete(jobs);
    for (const url of survivors) {
      const page = await db.pages.get(url);
      if (!page) continue;
      const remaining = (await db.visits.where('canonicalUrl').equals(url).sortBy('startedAt')).reverse();
      const replacement = remaining[0]!;
      const changes: Partial<typeof page> = {};
      if (page.sourceVisitId && gone.has(page.sourceVisitId)) changes.sourceVisitId = replacement.id;
      if (page.enrichmentVisitId && gone.has(page.enrichmentVisitId)) changes.enrichmentVisitId = replacement.id;
      if (Object.keys(changes).length) await db.pages.update(url, changes);
      const engaged = remaining.find((v) => v.engagement !== 'bounced' && !v.privacyBlocked);
      if (engaged) await enqueuePageEnrichment(db, engaged, now(), { ...page, ...changes });
    }

    const nodeIds = new Set([...visitIds, ...queryIds, ...forgottenExpeditions, ...urls]);
    const notes = await db.notes.where('nodeId').anyOf([...nodeIds]).primaryKeys();
    await db.notes.bulkDelete(notes);

    let edgesTouched = 0;
    for (const edge of await db.edges.toArray()) {
      const evidence = edge.evidence.filter((id) => !gone.has(id));
      if (nodeIds.has(edge.from) || nodeIds.has(edge.to) || (evidence.length === 0 && edge.evidence.length > 0)) {
        await db.edges.delete(edge.id);
        edgesTouched++;
      } else if (evidence.length !== edge.evidence.length) {
        await db.edges.update(edge.id, { evidence });
        edgesTouched++;
      }
    }

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
    for (const id of new Set(visits.flatMap((v) => v.expeditionId && !forgottenExpeditions.includes(v.expeditionId) ? [v.expeditionId] : []))) {
      await repairExpedition(db, id, { derivedContentRemoved: true });
    }

    const logIds = [...new Set([...nodeIds, ...(input.targetIds ?? [])])];
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
        notes: notes.length, jobs: jobs.length, auditRows: audit.length, edges: edgesTouched,
        expeditions: forgottenExpeditions.length,
      },
    });
    return { visitIds };
  });
}
