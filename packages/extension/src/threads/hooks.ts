import type { NotesWrittenHook } from '../wrapup/hooks';
import { enqueueThreadMatch } from './match';
import { refreshThread } from './model';

/** Notes and their follow-up jobs commit together. A changed source invalidates an old synthesis immediately. */
export const threadNotesWritten: NotesWrittenHook = async ({ db, expeditionId, at }) => {
  const expedition = await db.expeditions.get(expeditionId);
  if (!expedition) return;
  if (expedition.threadId) {
    const thread = await db.threads.get(expedition.threadId);
    await refreshThread(db, expedition.threadId, at, !!thread?.notedExpeditionIds?.includes(expeditionId));
  }
  await enqueueThreadMatch(db, expedition, at);
};
