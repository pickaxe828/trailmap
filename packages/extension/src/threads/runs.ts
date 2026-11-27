import type { TrailmapDb } from '../db/db';

/** One row per Expedition: how its latest `thread_match` went. Ids and numbers only; never titles, notes or page text. */
export type ThreadMatchRun = {
  expeditionId: string;
  at: number;
  outcome: 'joined' | 'suggested' | 'none' | 'waiting';
  reason: 'strong-match' | 'suggestion-band' | 'below-suggestion-band' | 'no-candidates' | 'already-in-thread' |
    'waiting-on-concepts' | 'embedder-unavailable';
  /** Candidates this Expedition could join, best first (at most `RUN_CANDIDATES`). */
  candidates: { kind: 'thread' | 'expedition'; id: string; similarity: number; shared: number; band: 0 | 1 | 2 }[];
  /** Candidates left out because the user dismissed that pairing. */
  dismissed: number;
};

export const RUN_CANDIDATES = 5;
const KEPT_RUNS = 50;

export const THREAD_MATCH_REASONS: Record<ThreadMatchRun['reason'], string> = {
  'strong-match': 'A strong match: joined automatically.',
  'suggestion-band': 'A possible match: "Part of …?" is shown.',
  'below-suggestion-band': 'No candidate was similar enough to suggest.',
  'no-candidates': 'Nothing from the last 60 days to compare with.',
  'already-in-thread': 'Already in a thread, or kept out of threads.',
  'waiting-on-concepts': 'Waiting for concepts from its pages to resolve.',
  'embedder-unavailable': 'The local embedder was unavailable; will retry.',
};

export async function recordThreadMatchRun(db: TrailmapDb, run: ThreadMatchRun) {
  await db.threadMatchRuns.put({ ...run, candidates: run.candidates.slice(0, RUN_CANDIDATES) });
  const surplus = await db.threadMatchRuns.orderBy('at').reverse().offset(KEPT_RUNS).primaryKeys();
  if (surplus.length) await db.threadMatchRuns.bulkDelete(surplus);
}

/** The latest runs, newest first, with the titles as they are now (a forgotten or renamed Expedition shows its current state). */
export async function readThreadMatchRuns(db: TrailmapDb, limit = 20) {
  return db.transaction('r', [db.threadMatchRuns, db.expeditions, db.threads], async () => {
    const runs = await db.threadMatchRuns.orderBy('at').reverse().limit(limit).toArray();
    const ids = [...new Set(runs.flatMap((run) => [run.expeditionId, ...run.candidates.filter(({ kind }) => kind === 'expedition').map(({ id }) => id)]))];
    const expeditions = new Map((await db.expeditions.bulkGet(ids)).flatMap((e) => e ? [[e.id, e.title] as const] : []));
    const threadIds = [...new Set(runs.flatMap((run) => run.candidates.filter(({ kind }) => kind === 'thread').map(({ id }) => id)))];
    const threads = new Map((await db.threads.bulkGet(threadIds)).flatMap((t) => t ? [[t.id, t.title] as const] : []));
    return runs.map((run) => ({ ...run, title: expeditions.get(run.expeditionId) ?? null,
      candidates: run.candidates.map((c) => ({ ...c, title: (c.kind === 'thread' ? threads : expeditions).get(c.id) ?? null })) }));
  });
}
