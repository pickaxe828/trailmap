import type { Expedition } from '@trailmap/shared';
import { readExpeditionTopConcepts } from '../concepts/read';
import type { TrailmapDb } from '../db/db';
import { cosine, quantize, type Embedder } from '../embeddings/embedder';
import { enqueueJob, JOB_PRIORITY, type JobHandlers } from '../jobs/queue';
import { dismissed } from '../journal/suggestions';
import { usesMyNotes, type RecordingSettings } from '../privacy/policy';
import { buildDescription } from './description';
import { recordThreadMatchRun, type ThreadMatchRun } from './runs';
import { bySessionTime, isClosedLearning, newThread, refreshThread, sessionEnd, THREAD_WINDOW } from './model';

type Signature = NonNullable<Expedition['threadSignature']>;
type Target = NonNullable<Expedition['threadSuggestion']>;

export function enqueueThreadMatch(db: TrailmapDb, { id: expeditionId, notesWrittenAt, myNotesAt }: Pick<Expedition, 'id' | 'notesWrittenAt' | 'myNotesAt'>, at: number) {
  return enqueueJob(db, {
    kind: 'thread_match', key: JSON.stringify([expeditionId, notesWrittenAt, myNotesAt]), priority: JOB_PRIORITY.fieldNotes,
    payload: { expeditionId, notesWrittenAt, myNotesAt },
  }, at);
}

/**
 * Band boundaries, calibrated on recorded MiniLM vectors (`threads/fixtures/`, PLAN §4.7). Real MiniLM scores for two sessions on
 * the same topic are low (0.30–0.62 on the fixtures; unrelated pairs stay under 0.30), so the old suggestion bands (0.72, or 0.60
 * with two shared concepts) were never reached. Joining automatically is deliberately unchanged: it still takes near-identical text.
 */
export const THREAD_BANDS = {
  autoJoin: { similarity: 0.94, withSharedConcept: 0.88 },
  suggest: { similarity: 0.40, withSharedConcept: 0.28, withTwoSharedConcepts: 0.22 },
} as const;

/** 0 = no match, 1 = possible match (suggest), 2 = strong match (attach). */
export function scoreMatch(source: Pick<Signature, 'vector' | 'conceptIds'>, candidate: Pick<Signature, 'vector' | 'conceptIds'>) {
  const similarity = cosine(source.vector, candidate.vector);
  const shared = source.conceptIds.filter((id) => candidate.conceptIds.includes(id)).length;
  const { autoJoin, suggest } = THREAD_BANDS;
  const band = similarity >= autoJoin.similarity || (similarity >= autoJoin.withSharedConcept && shared >= 1) ? 2 :
    similarity >= suggest.similarity || (similarity >= suggest.withSharedConcept && shared >= 1) ||
      (similarity >= suggest.withTwoSharedConcepts && shared >= 2) ? 1 : 0;
  return { band, similarity, shared, rank: similarity + Math.min(shared, 5) * 0.025 };
}

/** What an Expedition is about, for matching: see `buildDescription`. */
export async function describeExpedition(db: TrailmapDb, expedition: Expedition, settings: Pick<RecordingSettings, 'useMyNotes'> = {}) {
  const concepts = await readExpeditionTopConcepts(db, expedition.id);
  return { text: buildDescription({ ...expedition, concepts: concepts.map(({ name }) => name) }, usesMyNotes(settings)),
    conceptIds: concepts.map(({ id }) => id) };
}

/** FNV-1a. It only tells whether a description changed since a signature was made, so it need not be cryptographic. */
function hashDescription({ text, conceptIds }: { text: string; conceptIds: string[] }) {
  let hash = 0x811c9dc5;
  for (const char of `${text}\u0000${conceptIds.join(',')}`) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return hash.toString(36);
}

/** How long a closed Expedition waits for its pages' concepts before matching on what it has. */
export const CONCEPT_WAIT_MS = 15 * 60_000;
const RETRY_MS = 30_000;

/** Concepts come from `concept_resolution`, which runs after `page_enrichment`. Matching earlier would compare an Expedition without them. */
async function waitingOnConcepts(db: TrailmapDb, session: Expedition, at: number) {
  if (at - (session.notesWrittenAt ?? session.endedAt ?? at) >= CONCEPT_WAIT_MS) return false;
  const urls = new Set((await db.visits.where('expeditionId').equals(session.id).toArray()).map(({ canonicalUrl }) => canonicalUrl));
  if (!urls.size) return false;
  return !!(await db.jobs.where('status').anyOf('pending', 'leased').filter((job) =>
    (job.kind === 'concept_resolution' || job.kind === 'page_enrichment') && urls.has((job.payload as { canonicalUrl: string }).canonicalUrl)).first());
}

export function matchThread(db: TrailmapDb, embedder: Embedder, now: () => number,
  getSettings: () => Pick<RecordingSettings, 'useMyNotes'> = () => ({})): JobHandlers['thread_match'] {
  const tables = [db.expeditions, db.threads, db.visits, db.conceptEvidence, db.concepts, db.jobs];
  return async ({ payload: { expeditionId, notesWrittenAt, myNotesAt } }) => {
    const at = now();
    const earliest = at - THREAD_WINDOW;
    const prepare = () => db.transaction('r', tables, async () => {
      const session = await db.expeditions.get(expeditionId);
      if (!session || !isClosedLearning(session) || !session.fieldNotes?.trim() || session.notesWrittenAt !== notesWrittenAt || session.myNotesAt !== myNotesAt) return;
      const unavailable = !!session.threadId || !!session.threadAutoExcluded;
      if (await waitingOnConcepts(db, session, at)) return { session, waiting: true as const, singles: [], threads: [], skipped: 0, descriptions: [] };
      const open = unavailable ? [] : await db.threads.where('lastActiveAt').between(earliest, at, true, true)
        .filter((thread) => thread.status !== 'done' && !!thread.centroid).toArray();
      const threads = open.filter((thread) => !dismissed(session, { kind: 'thread', id: thread.id }));
      const eligible = unavailable ? [] : await db.expeditions.where('endedAt').between(earliest, at, true, true)
        .filter((other) => isClosedLearning(other) && bySessionTime(other, session) < 0 && !other.threadId && !other.threadAutoExcluded &&
          !!other.fieldNotes?.trim()).toArray();
      const singles = eligible.filter((other) => !dismissed(session, { kind: 'expedition', id: other.id }, other));
      // A stored signature is only reused while the Expedition is still described the same way.
      const descriptions = await Promise.all([session, ...singles].map(async (e) => {
        const description = await describeExpedition(db, e, getSettings());
        return { ...description, id: e.id, hash: hashDescription(description), fresh: !!e.threadSignature && e.threadSignature.descriptionHash === hashDescription(description) };
      }));
      return { session, waiting: false as const, singles, threads, skipped: open.length + eligible.length - threads.length - singles.length, descriptions };
    });
    const snapshot = await prepare();
    if (!snapshot) return 'discard';
    const { session, singles, threads, skipped, descriptions } = snapshot;
    const run = (outcome: ThreadMatchRun['outcome'], reason: ThreadMatchRun['reason'], candidates: ThreadMatchRun['candidates'] = []) =>
      recordThreadMatchRun(db, { expeditionId, at, outcome, reason, candidates, dismissed: skipped });
    if (snapshot.waiting) {
      await run('waiting', 'waiting-on-concepts');
      return { retryAt: now() + RETRY_MS };
    }
    const fingerprint = JSON.stringify(snapshot);
    const signatures = new Map<string, Signature>();
    const stale = descriptions.filter(({ id, fresh }) => id === session.id || !fresh);
    try {
      // Bound each call to the offscreen Embedder; fresh signatures need no inference.
      for (let start = 0; start < stale.length; start += 16) {
        const batch = stale.slice(start, start + 16);
        const vectors = await embedder.embed(batch.map(({ text }) => text));
        for (const [i, vector] of vectors.entries()) {
          const q8 = quantize(vector);
          if (q8) signatures.set(batch[i]!.id, { vector: q8, conceptIds: batch[i]!.conceptIds, descriptionHash: batch[i]!.hash });
        }
      }
    } catch {
      await run('waiting', 'embedder-unavailable');
      return { retryAt: now() + RETRY_MS };
    }
    const source = signatures.get(session.id);
    const candidates: { target: Target; signature: Signature; at: number }[] = [
      ...threads.map((thread) => ({ target: { kind: 'thread' as const, id: thread.id },
        signature: { vector: thread.centroid!, conceptIds: thread.conceptIds }, at: thread.lastActiveAt })),
      ...singles.flatMap((other) => {
        const signature = signatures.get(other.id) ?? other.threadSignature;
        return signature ? [{ target: { kind: 'expedition' as const, id: other.id }, signature, at: sessionEnd(other) }] : [];
      }),
    ];
    const ranked = source ? candidates.map((candidate) => ({ ...candidate, ...scoreMatch(source, candidate.signature) }))
      .sort((a, b) => b.band - a.band || b.rank - a.rank || b.at - a.at || a.target.id.localeCompare(b.target.id)) : [];
    const best = ranked[0];
    const listed = ranked.map(({ target, similarity, shared, band }) => ({ ...target, similarity: Math.round(similarity * 1000) / 1000, shared, band: band as 0 | 1 | 2 }));
    return { commit: async () => {
      // Don't attach against an obsolete title/concept/member snapshot after a correction or Forget.
      const current = await prepare();
      if (!current) return 'discard';
      if (JSON.stringify(current) !== fingerprint) return { retryAt: now() + 1_000 };
      for (const [id, signature] of signatures) await db.expeditions.update(id, { threadSignature: signature });
      await db.expeditions.update(expeditionId, { threadSuggestion: best?.band === 1 ? best.target : undefined });
      if (session.threadId || session.threadAutoExcluded) {
        await run('none', 'already-in-thread');
      } else if (best?.band === 2) {
        await run('joined', 'strong-match', listed);
      } else if (best?.band === 1) {
        await run('suggested', 'suggestion-band', listed);
      } else {
        await run('none', best ? 'below-suggestion-band' : 'no-candidates', listed);
      }
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
