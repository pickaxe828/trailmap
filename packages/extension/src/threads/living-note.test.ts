import { expect, test } from 'bun:test';
import type { Expedition, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { JobQueue } from '../jobs/queue';
import { discardJobs } from '../jobs/testing';
import { updateLivingNote } from './living-note';
import { newThread, refreshThread } from './model';

test('a legacy session with a skipped source does not stall later eligible sessions', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  try {
    await db.threads.add(newThread('thread', 10));
    for (const [i, host] of ['skip.test', 'learn.test'].entries()) {
      const id = `session-${i}`;
      const url = `https://${host}/`;
      await db.expeditions.add({ id, title: host, drivingQuestion: null, kind: 'learning', startedAt: i,
        endedAt: i + 1, userEdited: false, fieldNotes: `Notes from ${host}`, threadId: 'thread' });
      await db.visits.add({ id, url, canonicalUrl: url, title: host, engagement: 'read', expeditionId: id,
        startedAt: i, tabId: 1, parentVisitId: null, transition: 'typed', activeMs: 70_000, scrollDepth: 1 });
    }
    await db.transaction('rw', [db.threads, db.expeditions, db.jobs], () => refreshThread(db, 'thread', 10));
    const calls: unknown[] = [];
    const q = new JobQueue(db, () => 10, { ...discardJobs, living_note: updateLivingNote(db,
      () => ({ paused: false, skippedHosts: ['skip.test'] }), {
        now: () => 10, request: async (_db, payload, guard) => {
          expect(await guard.allow()).toBe(true);
          calls.push(JSON.parse(payload.input));
          return { output: { markdown: 'Safe synthesis' } };
        },
      }) }, [db.threads, db.expeditions, db.visits, db.pages]);
    while (await q.runNext()) { /* drain */ }
    expect(calls).toEqual([{ livingNote: null, fieldNotes: 'Notes from learn.test' }]);
    expect((await db.threads.get('thread'))?.livingNote).toBe('Safe synthesis');
  } finally { await db.delete(); }
});

test('a queued living note sends the current synthesis plus just the next session’s field notes', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  try {
    await db.threads.add(newThread('thread', 10));
    for (const [i, fieldNotes] of ['Notes from Monday\n- Opened but never read: a literal user note', 'Notes from Tuesday'].entries()) {
      const id = `session-${i}`;
      await db.expeditions.add({ id, title: 'Replicated lists', drivingQuestion: null, kind: 'learning', startedAt: i,
        endedAt: i + 1, userEdited: false, fieldNotes, threadId: 'thread',
        unreadStops: [{ visitId: `unread-${i}`, title: 'Local-only tab', url: 'https://unread.test/' }] } satisfies Expedition);
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
      { livingNote: null, fieldNotes: 'Notes from Monday\n- Opened but never read: a literal user note' },
      { livingNote: 'Monday synthesis', fieldNotes: 'Notes from Tuesday' },
    ]);
    expect((await db.threads.get('thread'))?.livingNote).toBe('Combined synthesis');
  } finally {
    await db.delete();
  }
});
