import type { TrailmapDb } from '../db/db';

export type NotesWrittenEvent = { db: TrailmapDb; expeditionId: string; at: number };
export type NotesWrittenHook = (event: NotesWrittenEvent) => Promise<void>;

/**
 * The "notes written" seam (ticket 19 thread matching, ticket 15 vault sync).
 * Hooks run inside the same Dexie transaction that stores the notes, so they
 * can enqueue durable jobs with `enqueueJob` and survive a worker restart. A
 * hook that writes tables must add them to the `resultTables` that
 * `startJobs` passes to `JobQueue`. Hooks never run for errands, nor when
 * user-edited notes blocked the write. Never call a model from a hook.
 */
export class NotesWrittenHooks {
  private readonly hooks = new Set<NotesWrittenHook>();

  register(hook: NotesWrittenHook): () => void {
    this.hooks.add(hook);
    return () => { this.hooks.delete(hook); };
  }

  async run(event: NotesWrittenEvent) {
    for (const hook of this.hooks) await hook(event);
  }
}

export const fieldNotesWritten = new NotesWrittenHooks();
