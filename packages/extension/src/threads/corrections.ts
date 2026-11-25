import type { Expedition } from '@trailmap/shared';
import type { CorrectionsOptions } from '../corrections/corrections';
import { enqueueThreadMatch } from './match';
import type { ThreadAction, ThreadActionResult } from './messages';
import { isClosedLearning, newThread, readThreadMembers, refreshThread, sessionEnd, THREAD_WINDOW } from './model';

export function createThreadCorrections({ db, now, newId }: CorrectionsOptions) {
  const assign = (ids: string[], threadId: string | null) => db.expeditions.where('id').anyOf(ids)
    .modify({ threadId, threadSuggestion: undefined, threadAutoExcluded: true });
  const membership = async (ids: string[]) => Object.fromEntries((await db.expeditions.bulkGet(ids))
    .flatMap((session) => session ? [[session.id, session.threadId]] : []));

  return async (input: ThreadAction): Promise<ThreadActionResult> =>
    db.transaction('rw', [db.expeditions, db.threads, db.jobs, db.corrections], async () => {
      const at = now();
      const log = (targetIds: string[], before: unknown, after: unknown) => db.corrections.add({
        id: newId(), at, kind: `thread-${input.action}`, targetIds: [...new Set(targetIds)], before, after,
      });
      const create = async () => {
        const id = `thread:${newId()}`;
        await db.threads.add(newThread(id, at));
        return id;
      };
      if (input.action === 'attach') {
        const { expeditionId, target, suggested } = input;
        const session = await db.expeditions.get(expeditionId);
        if (!session || !isClosedLearning(session) || expeditionId === target.id) return null;
        if (suggested && (session.threadId || session.threadSuggestion?.id !== target.id || session.threadSuggestion.kind !== target.kind)) return null;
        const other = target.kind === 'expedition' ? await db.expeditions.get(target.id) : undefined;
        if (target.kind === 'expedition' && (!other || other.threadId || !isClosedLearning(other) ||
          (suggested && (other.threadAutoExcluded || !other.fieldNotes || sessionEnd(other) < at - THREAD_WINDOW)))) return null;
        const thread = target.kind === 'thread' ? await db.threads.get(target.id) : undefined;
        if (target.kind === 'thread' && (!thread || (suggested && (thread.status === 'done' || thread.lastActiveAt < at - THREAD_WINDOW)))) return null;
        if (thread?.id === session.threadId) return null;
        const previousMembers = session.threadId ? await readThreadMembers(db, session.threadId) : [];
        const ids = [...new Set([session.id, ...(other ? [other.id] : []), ...previousMembers.map(({ id }) => id)])];
        const before = await membership(ids);
        const threadId = thread?.id ?? await create();
        await assign([session.id, ...(other ? [other.id] : [])], threadId);
        if (session.threadId) await refreshThread(db, session.threadId, at, true);
        await refreshThread(db, threadId, at);
        for (const member of [session, other]) {
          if (member?.fieldNotes && !member.threadSignature) await enqueueThreadMatch(db, member, at);
        }
        await log([threadId, ...ids, ...(session.threadId ? [session.threadId] : [])], before, await membership(ids));
        return { threadId };
      }
      const { threadId } = input;
      const thread = await db.threads.get(threadId);
      if (!thread) return null;
      const members = await readThreadMembers(db, threadId);
      const ids = members.map(({ id }) => id);
      switch (input.action) {
        case 'rename': {
          const title = input.title.trim();
          if (!title || title === thread.title) return null;
          await db.threads.update(threadId, { title, userRenamed: true });
          await log([threadId, ...ids], { title: thread.title }, { title });
          return { threadId };
        }
        case 'done':
          if (thread.status === 'done') return null;
          await db.threads.update(threadId, { status: 'done' });
          await log([threadId, ...ids], { status: thread.status }, { status: 'done' });
          return { threadId };
        case 'detach': {
          if (!ids.includes(input.expeditionId)) return null;
          const before = await membership(ids);
          await assign([input.expeditionId], null);
          await refreshThread(db, threadId, at, true);
          await log([threadId, ...ids], before, await membership(ids));
          return { threadId: members.length > 2 ? threadId : null };
        }
        case 'merge': {
          if (input.sourceId === threadId || !await db.threads.get(input.sourceId)) return null;
          const moved = (await readThreadMembers(db, input.sourceId)).map(({ id }) => id);
          if (!moved.length) return null;
          const before = await membership([...ids, ...moved]);
          await assign(moved, threadId);
          await refreshThread(db, input.sourceId, at, true);
          await refreshThread(db, threadId, at);
          await log([threadId, input.sourceId, ...ids, ...moved], before, await membership([...ids, ...moved]));
          return { threadId };
        }
        case 'split': {
          const moved = [...new Set(input.expeditionIds)];
          if (moved.length < 2 || moved.length >= ids.length || moved.some((id) => !ids.includes(id))) return null;
          const before = await membership(ids);
          const newThreadId = await create();
          await assign(moved, newThreadId);
          await refreshThread(db, threadId, at, true);
          await refreshThread(db, newThreadId, at);
          await log([threadId, newThreadId, ...ids], before, await membership(ids));
          return { threadId: newThreadId };
        }
      }
    });
}

/** Existing Expedition corrections can remove a session or change the input to its living note. */
export async function refreshEditedSessions(db: CorrectionsOptions['db'], sessions: (Expedition | undefined)[], at: number) {
  const threadIds = new Set(sessions.flatMap((session) => session?.threadId ? [session.threadId] : []));
  for (const id of threadIds) await refreshThread(db, id, at, true);
}
