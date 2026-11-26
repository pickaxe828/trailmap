import type { Expedition, Note, Query, Thread, Visit } from '@trailmap/shared';
import { createCorrections, type CorrectionsOptions } from '../corrections/corrections';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue';
import { enqueueThreadMatch } from '../threads/match';
import { clearThreadJobs, newThread, readThreadMembers, refreshThread, sessionEnd, THREAD_WINDOW } from '../threads/model';
import { readNotesProvenance } from '../threads/provenance';
import type { JournalAction } from './messages';
import { planOrganisation } from './organise';
import { dismissed, mergeSuggestionsByExpedition } from './suggestions';

const noNotes = { fieldNotes: null, notesSource: undefined, unreadStops: undefined, notesWrittenAt: undefined, unseenNotes: undefined } as const;
const noThread = { threadId: null, threadSignature: undefined, threadSuggestion: undefined } as const;
const present = <T>(items: (T | undefined)[]) => items.filter((item): item is T => item !== undefined);
const unique = (ids: string[]) => [...new Set(ids)].sort();
const snapshotFields = <T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((key) => [key, row[key]])) as Pick<T, K>;
const groupingFields = ['threadId', 'threadSuggestion', 'threadAutoExcluded'] as const;
const classificationFields = ['kind', 'kindOverride', ...Object.keys(noNotes) as (keyof typeof noNotes)[],
  ...groupingFields, 'threadSignature'] as const;
const mergeFields = ['title', 'startedAt', 'endedAt', 'rootVisitId', 'centroid', ...classificationFields] as const;

type Snapshot = {
  expeditions: Expedition[];
  threads: Thread[];
  visits: Pick<Visit, 'id' | 'expeditionId' | 'segmentationPending'>[];
  queries: Pick<Query, 'id' | 'expeditionId'>[];
  notes: Pick<Note, 'id' | 'nodeId'>[];
};
type Undo = {
  snapshot: Snapshot;
  selected: string[];
  scope: string[];
  threadIds: string[];
  action: string;
  sourceUrls: string[];
  autoMatchable: string[];
};

export function createJournalCorrections(options: CorrectionsOptions) {
  const { db, now, newId } = options;
  const corrections = createCorrections(options);
  const tables = [db.expeditions, db.threads, db.jobs, db.visits, db.queries, db.notes, db.pages, db.corrections];

  async function snapshot(scope: string[], threadIds: string[], merge: boolean): Promise<Snapshot> {
    return {
      expeditions: present(await db.expeditions.bulkGet(scope)),
      threads: present(await db.threads.bulkGet(threadIds)),
      visits: merge ? (await db.visits.where('expeditionId').anyOf(scope).toArray())
        .map((row) => snapshotFields(row, ['id', 'expeditionId', 'segmentationPending'])) : [],
      queries: merge ? (await db.queries.where('expeditionId').anyOf(scope).toArray())
        .map((row) => snapshotFields(row, ['id', 'expeditionId'])) : [],
      notes: merge ? (await db.notes.where('nodeId').anyOf(scope).toArray())
        .map((row) => snapshotFields(row, ['id', 'nodeId'])) : [],
    };
  }

  // Background jobs may write notes/signatures after a correction. Guard membership and closure,
  // not generated fields, so completing a job doesn't make Undo unusable.
  async function structure({ scope, threadIds, action, autoMatchable }: Undo) {
    const state = await snapshot(scope, threadIds, action === 'merge');
    const members = await db.expeditions.where('threadId').anyOf(threadIds).primaryKeys();
    return JSON.stringify([
      state.expeditions.map(({ id, threadId, kind, kindOverride, rootVisitId, startedAt, endedAt }) =>
        [id, autoMatchable.includes(id) ? null : threadId, kind, kindOverride, rootVisitId, startedAt, endedAt]),
      state.threads.map(({ id }) => id), members, state.visits, state.queries, state.notes,
    ]);
  }

  async function clearSessionJobs(ids: string[]) {
    await db.jobs.filter(({ kind, payload }) => (kind === 'thread_match' || kind === 'field_notes') &&
      'expeditionId' in payload && ids.includes(payload.expeditionId)).delete();
  }

  async function queueMissing(expedition: Expedition, revision: string, at: number) {
    const { id: expeditionId, endedAt } = expedition;
    if (expedition.kind !== 'learning' || endedAt === null) return;
    if (expedition.fieldNotes === null && (expedition.wrappedUpAt !== undefined || expedition.kindOverride)) {
      await enqueueJob(db, { kind: 'field_notes', key: JSON.stringify([expeditionId, endedAt, revision]),
        payload: { expeditionId, endedAt, revision: at }, priority: JOB_PRIORITY.fieldNotes }, at);
    } else if (expedition.fieldNotes && !expedition.threadSignature) await enqueueThreadMatch(db, expedition, at);
  }

  async function undo(id: string, at: number) {
    const entry = await db.corrections.get(id);
    if (!entry?.kind.startsWith('journal-') || entry.kind === 'journal-undo' || !entry.before) return null;
    const data = entry.before as Undo;
    const { snapshot: before, selected, threadIds, action } = data;
    if (await structure(data) !== entry.after) return null;
    // Notes may have produced an automatic match since this correction. Undo removes the
    // selected session from that thread too, unless the user has since edited the group.
    const matched = unique(present(await db.expeditions.bulkGet(data.autoMatchable))
      .flatMap(({ threadId }) => threadId ? [threadId] : [])).filter((id) => !threadIds.includes(id));
    const dependencies = new Set([...entry.targetIds, ...matched]);
    if (await db.corrections.where('at').aboveOrEqual(entry.at).and((other) => other.id !== id &&
      other.kind !== 'journal-undo' && other.before !== null && other.targetIds.some((target) => dependencies.has(target))).first()) return null;
    if (action === 'classify' || action === 'merge') await clearSessionJobs(selected);
    for (const previous of before.expeditions) {
      if (!await db.expeditions.get(previous.id)) await db.expeditions.put(previous);
      else {
        const keys = !selected.includes(previous.id) ? groupingFields
          : action === 'classify' ? classificationFields : action === 'merge' ? mergeFields
          : action === 'dismiss' ? ['dismissedSuggestions', 'threadSuggestion'] as const : groupingFields;
        await db.expeditions.update(previous.id, snapshotFields(previous, keys));
      }
    }
    for (const { id, ...fields } of before.visits) await db.visits.update(id, fields);
    for (const { id, ...fields } of before.queries) await db.queries.update(id, fields);
    for (const { id, ...fields } of before.notes) await db.notes.update(id, fields);
    for (const threadId of threadIds) {
      await clearThreadJobs(db, threadId);
      const previous = before.threads.find(({ id }) => id === threadId);
      if (previous) {
        await db.threads.put(previous);
        await refreshThread(db, threadId, at);
      } else await db.threads.delete(threadId);
    }
    for (const threadId of matched) await refreshThread(db, threadId, at, true);
    const undoId = newId();
    if (action === 'classify' || action === 'merge') {
      for (const session of present(await db.expeditions.bulkGet(selected))) await queueMissing(session, undoId, at);
    }
    // Drop the reversible payload once consumed; retain a record that this correction was undone.
    await db.corrections.update(id, { before: null, after: null });
    await db.corrections.add({ id: undoId, at, kind: 'journal-undo', targetIds: entry.targetIds, before: id, after: null });
    return undoId;
  }

  return async (input: JournalAction): Promise<string | null> => db.transaction('rw', tables, async () => {
    const at = now();
    if (input.action === 'undo') return undo(input.correctionId, at);
    let action = input;
    let pair: string[] = [];
    if (input.action === 'accept' || input.action === 'dismiss') {
      const { expeditionId, target } = input;
      const source = await db.expeditions.get(expeditionId);
      const other = target.kind === 'expedition' ? await db.expeditions.get(target.id) : undefined;
      const thread = target.kind === 'thread' ? await db.threads.get(target.id) : undefined;
      if (!source || (!other && !thread) || dismissed(source, target, other)) return null;
      const group = source.threadSuggestion?.kind === target.kind && source.threadSuggestion.id === target.id;
      if (input.action === 'dismiss') {
        if (!group && !(other && mergeSuggestionsByExpedition([source, other]).has(source.id))) return null;
      } else {
        if (!group || (thread && (thread.status === 'done' || thread.lastActiveAt < at - THREAD_WINDOW)) ||
          (other && (other.threadAutoExcluded || !other.fieldNotes || sessionEnd(other) < at - THREAD_WINDOW))) return null;
        const plan = planOrganisation(other ? [source, other] : [source],
          thread ? { action: 'add', threadId: thread.id } : { action: 'start' });
        if (!plan || (plan.action !== 'add' && plan.action !== 'start')) return null;
        action = plan;
      }
      pair = [expeditionId, target.id];
    }
    if (action.action === 'accept') return null;
    let selected = unique(action.action === 'dismiss' ? [action.expeditionId] : action.action === 'merge'
      ? [action.intoId, ...action.fromIds] : action.expeditionIds);
    const sessions = present(await db.expeditions.bulkGet(selected));
    if (sessions.length !== selected.length) return null;
    if (action.action === 'classify') {
      const plan = planOrganisation(sessions, action);
      if (plan?.action !== 'classify') return null;
      selected = plan.expeditionIds;
    }
    const creating = action.action === 'start';
    const destination = creating ? `thread:${newId()}` : action.action === 'add' ? action.threadId : undefined;
    if (action.action === 'start' || action.action === 'add') {
      if (!planOrganisation(sessions, action) || (!creating && (await readThreadMembers(db, destination!)).length < 2) ||
        (!creating && !await db.threads.get(destination!))) return null;
    }
    if (action.action === 'merge') {
      const plan = planOrganisation(sessions, action);
      if (plan?.action !== 'merge' || plan.intoId !== action.intoId || plan.fromIds.length !== action.fromIds.length ||
        !await db.visits.where('expeditionId').anyOf(selected).count()) return null;
      action = plan;
    }
    const threadIds = action.action === 'dismiss' ? [] : unique([
      ...sessions.flatMap(({ threadId }) => threadId ? [threadId] : []), ...(destination ? [destination] : []),
    ]);
    const scope = unique([...selected, ...(await db.expeditions.where('threadId').anyOf(threadIds).primaryKeys())]);
    const before = await snapshot(scope, threadIds, action.action === 'merge');
    const sources = (await Promise.all(before.expeditions.map(async (session) =>
      [session.wrapUpSource, session.fieldNotes ? await readNotesProvenance(db, session) : undefined]))).flat();
    const id = newId();
    if (action.action === 'dismiss') {
      const session = sessions[0]!;
      const { target } = action;
      await db.expeditions.update(session.id, { dismissedSuggestions: [...session.dismissedSuggestions ?? [], target],
        ...(session.threadSuggestion?.kind === target.kind && session.threadSuggestion.id === target.id ? { threadSuggestion: undefined } : {}) });
    } else if (action.action === 'classify') {
      await clearSessionJobs(selected);
      for (const session of sessions.filter(({ id }) => selected.includes(id))) {
        const changes = { kind: action.kind, kindOverride: true,
          ...(action.kind === 'errand' ? { ...noNotes, ...noThread } : {}) };
        await db.expeditions.update(session.id, changes);
        await queueMissing({ ...session, ...changes }, id, at);
      }
      for (const threadId of threadIds) await refreshThread(db, threadId, at, true);
    } else if (action.action === 'merge') {
      await clearSessionJobs(selected);
      for (const fromId of action.fromIds) await corrections.merge(action.intoId, fromId, { log: false });
      const survivor = await db.expeditions.get(action.intoId);
      if (survivor) await queueMissing(survivor, id, at);
    } else if (destination) {
      if (creating) await db.threads.add(newThread(destination, at));
      await db.expeditions.where('id').anyOf(selected).modify({ threadId: destination, threadSuggestion: undefined, threadAutoExcluded: true });
      await refreshThread(db, destination, at);
      for (const session of sessions) if (session.fieldNotes && !session.threadSignature) await enqueueThreadMatch(db, session, at);
    }
    const autoMatchable = action.action === 'classify' || action.action === 'merge'
      ? present(await db.expeditions.bulkGet(selected)).filter(({ kind, threadId }) => kind === 'learning' && !threadId).map(({ id }) => id) : [];
    const unread = before.expeditions.flatMap((session) => session.unreadStops ?? []);
    const data: Undo = { snapshot: before, selected, scope, threadIds, action: action.action, autoMatchable,
      sourceUrls: unique([...unread.map(({ url }) => url), ...sources.flatMap((source) => source?.canonicalUrls ?? [])]) };
    const referencedIds = before.expeditions.flatMap((session) => [
      ...(session.rootVisitId ? [session.rootVisitId] : []), ...(session.threadSuggestion ? [session.threadSuggestion.id] : []),
      ...(session.mergeSuggestions ?? []).map(({ expeditionId }) => expeditionId), ...(session.dismissedSuggestions ?? []).map(({ id }) => id),
    ]);
    await db.corrections.add({ id, at, kind: `journal-${action.action}`,
      targetIds: unique([...scope, ...threadIds, ...pair, ...before.visits.map(({ id }) => id), ...referencedIds,
        ...unread.map(({ visitId }) => visitId), ...sources.flatMap((source) => source?.visitIds ?? [])]), before: data, after: await structure(data) });
    return id;
  });
}
