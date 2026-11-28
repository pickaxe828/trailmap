import type { TrailmapDb } from '../db/db';

export const AI_MODE_STATS_ID = 'google-ai-mode';

/** Lifetime diagnostics: no link back to a turn, Visit, URL or timestamp. */
export type AiModeStats = {
  id: typeof AI_MODE_STATS_ID;
  successes: number;
  failures: number;
};

/** In the same transaction that settles a turn so replays cannot double-count. */
export async function addAiModeOutcomes(db: TrailmapDb, successes: number, failures: number) {
  const stats = await db.aiModeStats.get(AI_MODE_STATS_ID);
  await db.aiModeStats.put({ id: AI_MODE_STATS_ID,
    successes: (stats?.successes ?? 0) + successes, failures: (stats?.failures ?? 0) + failures });
}
