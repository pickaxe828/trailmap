import type { Expedition, Thread } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { quantize } from '../embeddings/embedder';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue';

const DAY = 86_400_000;
export const THREAD_WINDOW = 60 * DAY;
export const sessionEnd = (e: Expedition) => e.endedAt ?? e.startedAt;
export const bySessionTime = (a: Expedition, b: Expedition) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);
export const isClosedLearning = (e: Expedition) => e.kind === 'learning' && e.endedAt !== null;
export const threadStatus = (thread: Thread, at: number): Thread['status'] =>
  thread.status === 'done' ? 'done' : at - thread.lastActiveAt >= DAY ? 'dormant' : 'active';

export async function readDormantThreads(db: TrailmapDb, at = Date.now()): Promise<Thread[]> {
  return (await db.threads.where('lastActiveAt').between(at - THREAD_WINDOW, at, true, true).reverse().toArray())
    .filter((thread) => threadStatus(thread, at) === 'dormant')
    .map((thread) => ({ ...thread, status: 'dormant' }));
}

export async function readThreadMembers(db: TrailmapDb, threadId: string) {
  return (await db.expeditions.where('threadId').equals(threadId).filter(isClosedLearning).toArray()).sort(bySessionTime);
}

export async function queueLivingNote(db: TrailmapDb, thread: Thread, members: Expedition[], at: number) {
  const noted = thread.notedExpeditionIds ?? [];
  if (!members.some((member) => member.fieldNotes?.trim() && !noted.includes(member.id))) return;
  const payload = { threadId: thread.id, revision: thread.noteRevision ?? 0, checkpoint: noted.length };
  await enqueueJob(db, { kind: 'living_note', key: JSON.stringify(Object.values(payload)), priority: JOB_PRIORITY.fieldNotes, payload }, at);
}

export async function clearThreadJobs(db: TrailmapDb, id: string) {
  await db.jobs.filter(({ payload }) => 'threadId' in payload && payload.threadId === id).delete();
}

/** Call in a write transaction over threads, expeditions and jobs, after changing membership. */
export async function refreshThread(db: TrailmapDb, id: string, at: number, reset = false) {
  const [thread, members] = await Promise.all([db.threads.get(id), readThreadMembers(db, id)]);
  if (!thread) return;
  if (members.length < 2) {
    await db.expeditions.where('threadId').equals(id).modify({ threadId: null, threadSuggestion: undefined });
    await db.threads.delete(id);
    await clearThreadJobs(db, id);
    return;
  }
  const first = members[0]!;
  const vectors = members.flatMap((member) => member.threadSignature ? [member.threadSignature.vector] : []);
  const length = vectors[0]?.length ?? 0;
  const sum = new Float32Array(length);
  for (const vector of vectors) {
    if (vector.length === length) for (let i = 0; i < length; i++) sum[i] = sum[i]! + vector[i]!;
  }
  const next: Thread = {
    ...thread, title: thread.userRenamed ? thread.title : first.title, question: first.drivingQuestion,
    lastActiveAt: Math.max(...members.map(sessionEnd)), centroid: quantize(sum),
    conceptIds: [...new Set(members.flatMap((member) => member.threadSignature?.conceptIds ?? []))],
  };
  next.status = threadStatus(next, at);
  if (reset) {
    next.noteRevision = (thread.noteRevision ?? 0) + 1;
    next.livingNote = null;
    next.notedExpeditionIds = [];
    await clearThreadJobs(db, id);
  }
  await db.threads.put(next);
  await queueLivingNote(db, next, members, at);
}

export function newThread(id: string, at: number): Thread {
  return { id, title: '', question: null, status: 'active', lastActiveAt: at, livingNote: null, centroid: null, conceptIds: [] };
}
