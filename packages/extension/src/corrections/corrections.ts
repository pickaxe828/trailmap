import type { Visit } from '@trailmap/shared';
import type { CorrectionLogEntry, TrailmapDb } from '../db/db';
import { forgetCascade, type ForgetResult } from './forget';
import { repairExpedition } from './repair';
import { enqueueNotesEnrichment } from '../notes/enqueue';
import { enqueueThreadMatch } from '../threads/match';
import { refreshEditedSessions } from '../threads/corrections';
import { refreshThread } from '../threads/model';
import { preserveLegacyNotesSources } from '../threads/provenance';
import { refreshExpeditionCentroid } from '../segmentation/expedition-recorder';

export type CorrectionsOptions = { db: TrailmapDb; now: () => number; newId: () => string };
type SessionEdit = { sessionId: string; allowVisit?: (visit: Visit | undefined) => boolean };
const sessionKey = (id: string) => `notes-session:${id}`;
const noteText = (value: unknown): string | null | undefined => {
  const text = (value as { text?: unknown } | null)?.text;
  return text === null || typeof text === 'string' ? text : undefined;
};

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

  const noteTables = [db.notes, db.corrections, db.visits, db.queries, db.expeditions, db.jobs,
    db.conceptEvidence, db.concepts, db.edges];
  const notesAt = (nodeId: string) => db.notes.where('nodeId').equals(nodeId);
  async function writeNote(nodeId: string, text: string | null, expeditionId?: string | null) {
    await notesAt(nodeId).delete();
    if (text) await db.notes.add({ id: newId(), nodeId, text, at: now() });
    if (expeditionId) await enqueueNotesEnrichment(db, expeditionId, now());
  }

  const matchingSession = (entry: CorrectionLogEntry, kind: string, targetIds: string[]) =>
    entry.kind === kind && entry.before !== null && entry.targetIds.length === targetIds.length &&
    targetIds.every((id, i) => entry.targetIds[i] === id);

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

    /** One Note per node. Autosaves update the same log row, keeping the original `before`. */
    async note(nodeId: string, text: string, edit?: SessionEdit) {
      return db.transaction('rw', noteTables, async () => {
        const visit = await db.visits.get(nodeId);
        if (visit?.privacyBlocked || (edit?.allowVisit && !edit.allowVisit(visit))) return false;
        const stop = visit ?? await db.queries.get(nodeId);
        if (!stop && !await db.expeditions.get(nodeId)) return false;
        const targetIds = [nodeId];
        const id = edit ? sessionKey(edit.sessionId) : newId();
        const entry = edit ? await db.corrections.get(id) : undefined;
        const previous = (await notesAt(nodeId).first())?.text ?? null;
        if (entry && (!matchingSession(entry, 'note', targetIds) || noteText(entry.after) !== previous)) return false;
        const next = text.trim() || null;
        if (previous === next) return true;
        await writeNote(nodeId, next, stop?.expeditionId ?? (stop ? null : nodeId));
        await db.corrections.put({ id, kind: 'note', targetIds, at: now(),
          before: entry?.before ?? { text: previous }, after: { text: next } });
        return true;
      });
    },

    async undoNote(entry: CorrectionLogEntry, at: number) {
      const [nodeId] = entry.targetIds;
      const before = noteText(entry.before);
      const after = noteText(entry.after);
      if (entry.kind !== 'note' || !nodeId || entry.targetIds.length !== 1 || before === undefined || after === undefined) return null;
      const visit = await db.visits.get(nodeId);
      if (visit?.privacyBlocked) return null;
      const stop = visit ?? await db.queries.get(nodeId);
      if (!stop && !await db.expeditions.get(nodeId)) return null;
      if (((await notesAt(nodeId).first())?.text ?? null) !== after ||
        await db.corrections.where('targetIds').equals(nodeId).filter((other) =>
          other.kind === 'note' && other.at > entry.at && other.before !== null).first()) return null;
      await writeNote(nodeId, before, stop?.expeditionId ?? (stop ? null : nodeId));
      const id = newId();
      await db.corrections.update(entry.id, { before: null, after: null });
      await db.corrections.add({ id, at, kind: 'journal-undo', targetIds: entry.targetIds, before: entry.id, after: null });
      return id;
    },

    async rename(expeditionId: string, title: string) {
      const next = title.trim();
      if (!next) return false;
      return db.transaction('rw', [db.expeditions, db.corrections, db.threads, db.jobs], async () => {
        const expedition = await db.expeditions.get(expeditionId);
        if (!expedition) return false;
        await db.expeditions.update(expeditionId, { title: next, userEdited: true });
        if (expedition.threadId) await refreshThread(db, expedition.threadId, now());
        await logEntry('rename', [expeditionId], { title: expedition.title }, { title: next });
        return true;
      });
    },

    /**
     * My notes (PLAN §3) sit beside the generated field notes and are never overwritten by them. Saving rebuilds what the
     * thread matcher and living note know about this Expedition and, after a pause, asks the model for its concepts.
     */
    async editMyNotes(expeditionId: string, text: string, edit?: SessionEdit & { visitId: string }): Promise<boolean> {
      return db.transaction('rw', [db.expeditions, db.corrections, db.threads, db.jobs, db.visits, db.queries, db.notes,
        db.conceptEvidence, db.concepts, db.edges], async () => {
        const expedition = await db.expeditions.get(expeditionId);
        if (!expedition) return false;
        const targetIds = [expeditionId, ...(edit ? [edit.visitId] : [])];
        const id = edit ? sessionKey(edit.sessionId) : newId();
        const entry = edit ? await db.corrections.get(id) : undefined;
        if (edit) {
          const visit = await db.visits.get(edit.visitId);
          if (visit?.expeditionId !== expeditionId || visit.privacyBlocked || (edit.allowVisit && !edit.allowVisit(visit))) return false;
          if (entry && (!matchingSession(entry, 'my-notes', targetIds) || entry.at !== expedition.myNotesAt)) return false;
        }
        const at = now();
        const trimmed = text.trim();
        if (trimmed === (expedition.myNotes ?? '')) return true;
        await db.expeditions.update(expeditionId, { myNotes: trimmed || undefined, myNotesAt: trimmed || expedition.myNotes ? at : undefined,
          threadSignature: undefined, threadSuggestion: undefined });
        await refreshEditedSessions(db, [expedition], at);
        await enqueueNotesEnrichment(db, expeditionId, at);
        const current = await db.expeditions.get(expeditionId);
        if (current?.fieldNotes && !current.threadId) await enqueueThreadMatch(db, current, at);
        // Counts only: the text itself would outlive a Forget of the pages it was written about.
        await db.corrections.put({ id, kind: 'my-notes', at, targetIds,
          before: entry?.before ?? { length: expedition.myNotes?.length ?? 0 }, after: { length: trimmed.length } });
        return true;
      });
    },

    /** Moves a Visit and everything reached from it into a new Expedition. Returns its id, or null if nothing changed. */
    async split(visitId: string): Promise<string | null> {
      return db.transaction('rw', [db.visits, db.queries, db.expeditions, db.corrections, db.pages], async () => {
        const root = await db.visits.get(visitId);
        const source = root?.expeditionId ? await db.expeditions.get(root.expeditionId) : undefined;
        if (!root || !source || source.rootVisitId === visitId) return null;
        await preserveLegacyNotesSources(db, [source]);
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
        await logEntry('split', [...ids, source.id, id], { visits: before },
          { visits: await membership(ids), expeditionId: id, fromExpeditionId: source.id });
        return id;
      });
    },

    /** Moves one Visit (and its Query) into another Expedition. */
    async move(visitId: string, toExpeditionId: string) {
      return db.transaction('rw', [db.visits, db.queries, db.expeditions, db.notes, db.corrections, db.threads, db.jobs, db.pages], async () => {
        const visit = await db.visits.get(visitId);
        const target = await db.expeditions.get(toExpeditionId);
        if (!visit || !target || visit.expeditionId === toExpeditionId) return false;
        const fromId = visit.expeditionId;
        const source = fromId ? await db.expeditions.get(fromId) : undefined;
        await preserveLegacyNotesSources(db, [source, target]);
        await assign([visitId], toExpeditionId);
        if (fromId) await repairExpedition(db, fromId);
        await repairExpedition(db, toExpeditionId);
        await refreshEditedSessions(db, [source, target], now());
        await logEntry('move', [visitId, toExpeditionId, ...(fromId ? [fromId] : [])],
          { visits: { [visitId]: fromId } }, { visits: { [visitId]: toExpeditionId } });
        return true;
      });
    },

    /** Folds `fromId` into `intoId`. The target keeps its title and notes. */
    async merge(intoId: string, fromId: string, { log = true } = {}) {
      if (intoId === fromId) return false;
      return db.transaction('rw', [db.visits, db.queries, db.expeditions, db.notes, db.corrections, db.threads, db.jobs, db.pages], async () => {
        const into = await db.expeditions.get(intoId);
        const from = await db.expeditions.get(fromId);
        if (!into || !from) return false;
        await preserveLegacyNotesSources(db, [into]);
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
        const merged = await db.expeditions.get(intoId);
        if (merged?.threadId && merged.endedAt === null) await db.expeditions.update(intoId, { threadId: null });
        await refreshEditedSessions(db, [into, from], now());
        if (log) await logEntry('merge', [intoId, fromId, ...ids],
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
      return forgetCascade(db, { kind: 'forget-site', host, targetIds: [`site:${host}`], now, newId });
    },

    /** The skip list itself is owned by the privacy controller; this only records the change. */
    async logSiteIgnored() {
      await logEntry('ignore-site', [], { skipped: false }, { skipped: true });
    },
  };
}

export type Corrections = ReturnType<typeof createCorrections>;
