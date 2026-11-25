import { expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { JobQueue } from '../jobs/queue';
import { discardJobs } from '../jobs/testing';
import { updateLivingNote } from './living-note';
import { newThread, refreshThread } from './model';

test('a queued living note sends the current synthesis plus just the next session’s field notes', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  try {
    await db.threads.add(newThread('thread', 10));
    for (const [i, fieldNotes] of ['Notes from Monday', 'Notes from Tuesday'].entries()) {
      const id = `session-${i}`;
      await db.expeditions.add({ id, title: 'Replicated lists', drivingQuestion: null, kind: 'learning', startedAt: i,
        endedAt: i + 1, userEdited: false, fieldNotes, threadId: 'thread' } satisfies Expedition);
      const url = `https://learn.test/${id}`;
      await db.visits.add({ id, url, canonicalUrl: url, title: 'List implementation', engagement: 'read', expeditionId: id,
        startedAt: i, tabId: 1, parentVisitId: null, transition: 'typed', activeMs: 70_000, scrollDepth: 1 } satisfies Visit);
    }
    await db.transaction('rw', [db.threads, db.expeditions, db.jobs], () => refreshThread(db, 'thread', 10));
    const calls: unknown[] = [];
    const queue = new JobQueue(db, () => 10, { ...discardJobs, living_note: updateLivingNote(db, () => ({ paused: false, skippedHosts: [] }), {
      now: () => 10, request: async (_db, payload, guard) => {
        expect(await guard.allow()).toBe(true);
        calls.push(JSON.parse(payload.input as string));
        return { output: { markdown: calls.length === 1 ? 'Monday synthesis' : 'Combined synthesis' } };
      },
    }) }, [db.threads, db.expeditions, db.visits, db.pages]);
    expect(await queue.runNext()).toBe(true);
    expect(await queue.runNext()).toBe(true);
    expect(await queue.runNext()).toBe(false);
    expect(calls).toEqual([
      { livingNote: null, fieldNotes: 'Notes from Monday' },
      { livingNote: 'Monday synthesis', fieldNotes: 'Notes from Tuesday' },
    ]);
    expect((await db.threads.get('thread'))?.livingNote).toBe('Combined synthesis');
  } finally {
    await db.delete();
  }
});
