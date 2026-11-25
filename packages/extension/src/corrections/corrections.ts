import type { Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { forgetCascade, hostMatches, type ForgetResult } from './forget';
import { repairExpedition } from './repair';
import { refreshExpeditionCentroid } from '../segmentation/expedition-recorder';

export type CorrectionsOptions = { db: TrailmapDb; now: () => number; newId: () => string };

/**
 * One-click fixes to the trail (docs/PLAN.md §4.3 rule 5, §5 item 1). Every
 * correction is one Dexie transaction that also writes a log entry holding the
 * state before and after, so segmentation thresholds can be tuned later.
 * Log entries carry `targetIds` so Forget can remove the ones that mention
 * forgotten items.
 */
export function createCorrections({ db, now, newId }: CorrectionsOptions) {
  const logEntry = (kind: string, targetIds: string[], before: unknown, after: unknown) =>
    db.corrections.add({ id: newId(), at: now(), kind, targetIds, before, after });

  /** Membership is Visit.expeditionId, mirrored on the Visit's Query (docs: notes-09). Call inside a transaction. */
  async function assign(visitIds: string[], expeditionId: string) {
    await db.visits.where('id').anyOf(visitIds).modify((visit: Visit) => {
      visit.expeditionId = expeditionId;
      delete visit.segmentationPending; // The user has decided; segmentation must not revisit it.
    });
    await db.queries.where('visitId').anyOf(visitIds).modify({ expeditionId });
  }

  const membership = async (visitIds: string[]) =>
    Object.fromEntries((await db.visits.bulkGet(visitIds)).flatMap((v) => v ? [[v.id, v.expeditionId]] : []));

  return {
    async star(visitId: string, starred: boolean) {
      await db.transaction('rw', db.visits, db.corrections, async () => {
        const visit = await db.visits.get(visitId);
        if (!visit) return;
        await db.visits.update(visitId, { starred: starred ? true : undefined });
        await logEntry('star', [visitId], { starred: !!visit.starred }, { starred });
      });
    },

    /** One Note per node: saving replaces it, empty text removes it. */
    async note(nodeId: string, text: string) {
      const trimmed = text.trim();
      await db.transaction('rw', db.notes, db.corrections, async () => {
        const existing = await db.notes.where('nodeId').equals(nodeId).toArray();
        await db.notes.bulkDelete(existing.map(({ id }) => id));
        if (trimmed) await db.notes.add({ id: newId(), nodeId, text: trimmed, at: now() });
        await logEntry('note', [nodeId], { text: existing[0]?.text ?? null }, { text: trimmed || null });
      });
    },

    async rename(expeditionId: string, title: string) {
      const next = title.trim();
      if (!next) return false;
      return db.transaction('rw', db.expeditions, db.corrections, async () => {
        const expedition = await db.expeditions.get(expeditionId);
        if (!expedition) return false;
        await db.expeditions.update(expeditionId, { title: next, userEdited: true });
        await logEntry('rename', [expeditionId], { title: expedition.title }, { title: next });
        return true;
      });
    },

    async editFieldNotes(expeditionId: string, text: string): Promise<boolean> {
      return db.transaction('rw', db.expeditions, db.corrections, async () => {
        const expedition = await db.expeditions.get(expeditionId);
        if (!expedition) return false;
        const at = now();
        await db.expeditions.update(expeditionId, { fieldNotes: text, userEdited: true, notesWrittenAt: at, unseenNotes: undefined });
        // Unlike a manual Note, generated field notes can quote many Visits. Avoid
        // duplicating their content in the correction log when those Visits are forgotten.
        await logEntry('field-notes', [expeditionId],
          { userEdited: expedition.userEdited, notesWrittenAt: expedition.notesWrittenAt },
          { userEdited: true, notesWrittenAt: at });
        return true;
      });
    },

    /** Moves a Visit and everything reached from it into a new Expedition. Returns its id, or null if nothing changed. */
    async split(visitId: string): Promise<string | null> {
      return db.transaction('rw', db.visits, db.queries, db.expeditions, db.corrections, async () => {
        const root = await db.visits.get(visitId);
        const source = root?.expeditionId ? await db.expeditions.get(root.expeditionId) : undefined;
        if (!root || !source || source.rootVisitId === visitId) return null;
        const members = await db.visits.where('expeditionId').equals(source.id).toArray();
        const moved = new Set([visitId]);
        for (let grew = true; grew;) {
          grew = false;
          for (const member of members) {
            if (member.parentVisitId && moved.has(member.parentVisitId) && !moved.has(member.id)) {
              moved.add(member.id);
              grew = true;
            }
          }
        }
        const ids = [...moved];
        const query = await db.queries.where('visitId').equals(visitId).first();
        const id = `expedition:${newId()}`;
        const before = await membership(ids);
        await db.expeditions.add({
          id, rootVisitId: visitId, centroid: null, kind: 'learning', startedAt: root.startedAt, endedAt: source.endedAt,
          title: query?.q.trim() || root.title.trim() || URL.parse(root.canonicalUrl)?.hostname || 'Untitled page',
          drivingQuestion: null, fieldNotes: null, userEdited: false, threadId: null,
        });
        await assign(ids, id);
        await refreshExpeditionCentroid(db, id);
        await refreshExpeditionCentroid(db, source.id);
        await logEntry('split', [visitId, source.id, id], { visits: before },
          { visits: await membership(ids), expeditionId: id, fromExpeditionId: source.id });
        return id;
      });
    },

    /** Moves one Visit (and its Query) into another Expedition. */
    async move(visitId: string, toExpeditionId: string) {
      return db.transaction('rw', db.visits, db.queries, db.expeditions, db.notes, db.corrections, async () => {
        const visit = await db.visits.get(visitId);
        const target = await db.expeditions.get(toExpeditionId);
        if (!visit || !target || visit.expeditionId === toExpeditionId) return false;
        const fromId = visit.expeditionId;
        await assign([visitId], toExpeditionId);
        if (fromId) await repairExpedition(db, fromId);
        await repairExpedition(db, toExpeditionId);
        await logEntry('move', [visitId, toExpeditionId, ...(fromId ? [fromId] : [])],
          { visits: { [visitId]: fromId } }, { visits: { [visitId]: toExpeditionId } });
        return true;
      });
    },

    /** Folds `fromId` into `intoId`. The target keeps its title and notes. */
    async merge(intoId: string, fromId: string) {
      if (intoId === fromId) return false;
      return db.transaction('rw', db.visits, db.queries, db.expeditions, db.notes, db.corrections, async () => {
        const into = await db.expeditions.get(intoId);
        const from = await db.expeditions.get(fromId);
        if (!into || !from) return false;
        const ids = (await db.visits.where('expeditionId').equals(fromId).primaryKeys()) as string[];
        const before = await membership(ids);
        await assign(ids, intoId);
        await db.queries.where('expeditionId').equals(fromId).modify({ expeditionId: intoId });
        await db.notes.where('nodeId').equals(fromId).modify({ nodeId: intoId });
        const earlier = from.startedAt < into.startedAt ? from : into;
        await db.expeditions.update(intoId, {
          startedAt: earlier.startedAt, rootVisitId: earlier.rootVisitId ?? into.rootVisitId,
          endedAt: into.endedAt === null || from.endedAt === null ? null : Math.max(into.endedAt, from.endedAt),
        });
        await db.expeditions.delete(fromId);
        await repairExpedition(db, intoId);
        await logEntry('merge', [intoId, fromId, ...ids],
          { visits: before, intoId, fromId, fromTitle: from.title }, { visits: await membership(ids) });
        return true;
      });
    },

    async forgetPage(canonicalUrl: string): Promise<ForgetResult> {
      const visitIds = (await db.visits.where('canonicalUrl').equals(canonicalUrl).primaryKeys()) as string[];
      return forgetCascade(db, { kind: 'forget-page', visitIds, pageUrls: [canonicalUrl], now, newId });
    },

    async forgetExpedition(expeditionId: string): Promise<ForgetResult> {
      const visitIds = (await db.visits.where('expeditionId').equals(expeditionId).primaryKeys()) as string[];
      return forgetCascade(db, { kind: 'forget-expedition', visitIds, expeditionIds: [expeditionId], now, newId });
    },

    /** `host` is a site key: the hostname and its subdomains. */
    async forgetSite(host: string): Promise<ForgetResult> {
      const visitIds = (await db.visits.filter(({ url, canonicalUrl }) => hostMatches(url, host) || hostMatches(canonicalUrl, host))
        .primaryKeys()) as string[];
      const pageUrls = (await db.pages.filter(({ canonicalUrl, sourceUrl }) =>
        hostMatches(canonicalUrl, host) || hostMatches(sourceUrl, host)).primaryKeys()) as string[];
      return forgetCascade(db, { kind: 'forget-site', visitIds, pageUrls, targetIds: [`site:${host}`], now, newId });
    },

    /** The skip list itself is owned by the privacy controller; this only records the change. */
    async logSiteIgnored(host: string) {
      await logEntry('ignore-site', [`site:${host}`], { skipped: false }, { skipped: true, host });
    },
  };
}

export type Corrections = ReturnType<typeof createCorrections>;
