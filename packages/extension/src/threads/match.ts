import type { Expedition } from '@trailmap/shared';
import { readExpeditionTopConcepts } from '../concepts/read';
import type { TrailmapDb } from '../db/db';
import { cosine, quantize, type Embedder } from '../embeddings/embedder';
import { enqueueJob, JOB_PRIORITY, type JobHandlers } from '../jobs/queue';
import { dismissed } from '../journal/suggestions';
import { bySessionTime, isClosedLearning, newThread, refreshThread, sessionEnd, THREAD_WINDOW } from './model';

type Signature = NonNullable<Expedition['threadSignature']>;
type Target = NonNullable<Expedition['threadSuggestion']>;

export function enqueueThreadMatch(db: TrailmapDb, { id: expeditionId, notesWrittenAt }: Pick<Expedition, 'id' | 'notesWrittenAt'>, at: number) {
  return enqueueJob(db, {
    kind: 'thread_match', key: JSON.stringify([expeditionId, notesWrittenAt]), priority: JOB_PRIORITY.fieldNotes,
    payload: { expeditionId, notesWrittenAt },
  }, at);
}

/** The spec names the bands but not their boundaries. Require more semantic agreement without shared concepts. */
function score(source: Signature, candidate: Signature) {
  const similarity = cosine(source.vector, candidate.vector);
  const shared = source.conceptIds.filter((id) => candidate.conceptIds.includes(id)).length;
  const band = similarity >= 0.94 || (similarity >= 0.88 && shared >= 1) ? 2 :
    similarity >= 0.72 || (similarity >= 0.60 && shared >= 2) ? 1 : 0;
  return { band, rank: similarity + Math.min(shared, 5) * 0.025 };
}

async function describe(db: TrailmapDb, expedition: Expedition) {
  const concepts = await readExpeditionTopConcepts(db, expedition.id);
  return { text: [expedition.title, expedition.drivingQuestion, ...concepts.map(({ name }) => name)].filter(Boolean).join('\n'),
    conceptIds: concepts.map(({ id }) => id) };
}

export function matchThread(db: TrailmapDb, embedder: Embedder, now: () => number): JobHandlers['thread_match'] {
  const tables = [db.expeditions, db.threads, db.visits, db.conceptEvidence, db.concepts];
  return async ({ payload: { expeditionId, notesWrittenAt } }) => {
    const at = now();
    const earliest = at - THREAD_WINDOW;
    const prepare = () => db.transaction('r', tables, async () => {
      const session = await db.expeditions.get(expeditionId);
      if (!session || !isClosedLearning(session) || !session.fieldNotes?.trim() || session.notesWrittenAt !== notesWrittenAt) return;
      const threads = session.threadId || session.threadAutoExcluded ? [] : await db.threads.where('lastActiveAt')
        .between(earliest, at, true, true).filter((thread) => thread.status !== 'done' && !!thread.centroid &&
          !dismissed(session, { kind: 'thread', id: thread.id })).toArray();
      const singles = session.threadId || session.threadAutoExcluded ? [] : await db.expeditions.where('endedAt')
        .between(earliest, at, true, true).filter((other) => isClosedLearning(other) && bySessionTime(other, session) < 0 &&
          !other.threadId && !other.threadAutoExcluded && !!other.fieldNotes?.trim() &&
          !dismissed(session, { kind: 'expedition', id: other.id }, other)).toArray();
      const toEmbed = [session, ...singles.filter((other) => !other.threadSignature)];
      return { session, singles, threads, descriptions: await Promise.all(toEmbed.map((e) => describe(db, e))) };
    });
    const snapshot = await prepare();
    if (!snapshot) return 'discard';
    const { session, singles, threads, descriptions } = snapshot;
    const fingerprint = JSON.stringify(snapshot);
    const signatures = new Map<string, Signature>();
    try {
      const ids = [session.id, ...singles.filter((other) => !other.threadSignature).map(({ id }) => id)];
      // Bound each call to the offscreen Embedder; existing signatures need no inference.
      for (let start = 0; start < descriptions.length; start += 16) {
        const vectors = await embedder.embed(descriptions.slice(start, start + 16).map(({ text }) => text));
        for (const [i, vector] of vectors.entries()) {
          const q8 = quantize(vector);
          if (q8) signatures.set(ids[start + i]!, { vector: q8, conceptIds: descriptions[start + i]!.conceptIds });
        }
      }
    } catch {
      return { retryAt: now() + 30_000 };
    }
    const source = signatures.get(session.id);
    const candidates: { target: Target; signature: Signature; at: number }[] = [
      ...threads.map((thread) => ({ target: { kind: 'thread' as const, id: thread.id },
        signature: { vector: thread.centroid!, conceptIds: thread.conceptIds }, at: thread.lastActiveAt })),
      ...singles.flatMap((other) => {
        const signature = other.threadSignature ?? signatures.get(other.id);
        return signature ? [{ target: { kind: 'expedition' as const, id: other.id }, signature, at: sessionEnd(other) }] : [];
      }),
    ];
    const best = source && candidates.map((candidate) => ({ ...candidate, ...score(source, candidate.signature) }))
      .sort((a, b) => b.band - a.band || b.rank - a.rank || b.at - a.at || a.target.id.localeCompare(b.target.id))[0];
    return { commit: async () => {
      // Don't attach against an obsolete title/concept/member snapshot after a correction or Forget.
      const current = await prepare();
      if (!current) return 'discard';
      if (JSON.stringify(current) !== fingerprint) return { retryAt: now() + 1_000 };
      for (const [id, signature] of signatures) await db.expeditions.update(id, { threadSignature: signature });
      await db.expeditions.update(expeditionId, { threadSuggestion: best?.band === 1 ? best.target : undefined });
      if (session.threadId) {
        await refreshThread(db, session.threadId, at);
      } else if (best?.band === 2) {
        const threadId = best.target.kind === 'thread' ? best.target.id : `thread:${crypto.randomUUID()}`;
        if (best.target.kind === 'expedition') {
          await db.threads.add(newThread(threadId, at));
          await db.expeditions.update(best.target.id, { threadId, threadSuggestion: undefined });
        }
        await db.expeditions.update(expeditionId, { threadId });
        await refreshThread(db, threadId, at);
      }
    } };
  };
}
