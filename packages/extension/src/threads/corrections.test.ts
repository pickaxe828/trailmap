import { expect, test } from 'bun:test';
import { openTrailmapDb } from '../db/db';
import { createThreadCorrections } from './corrections';
import { readThreadMembers } from './model';

test('sessions can be attached, split, merged and detached; thread corrections are logged', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  const now = () => 1000;
  let counter = 0;
  const correct = createThreadCorrections({ db, now, newId: () => `${++counter}`.padStart(3, '0') });
  try {
    for (const [i, id] of ['a', 'b', 'c', 'd', 'errand'].entries()) {
      await db.expeditions.add({ id, title: id, startedAt: i, endedAt: i + 1, drivingQuestion: null,
        userEdited: false, fieldNotes: 'Evidence', threadId: null, kind: id === 'errand' ? 'errand' : 'learning' });
    }
    const result = await correct({ action: 'attach', expeditionId: 'b', target: { kind: 'expedition', id: 'a' } });
    expect(result?.threadId).toBeTruthy();
    const threadId = result!.threadId!;
    for (const expeditionId of ['c', 'd']) {
      expect(await correct({ action: 'attach', expeditionId, target: { kind: 'thread', id: threadId } })).toBeTruthy();
    }
    expect(await correct({ action: 'attach', expeditionId: 'errand', target: { kind: 'thread', id: threadId } })).toBeNull();
    const split = await correct({ action: 'split', threadId, expeditionIds: ['c', 'd'] });
    expect((await readThreadMembers(db, split!.threadId!)).map(({ id }) => id)).toEqual(['c', 'd']);
    await correct({ action: 'rename', threadId, title: 'Replicated data' });
    await correct({ action: 'merge', threadId, sourceId: split!.threadId! });
    await correct({ action: 'detach', threadId, expeditionId: 'd' });
    await correct({ action: 'done', threadId });
    expect(await db.threads.get(threadId)).toMatchObject({ title: 'Replicated data', status: 'done' });
    expect((await readThreadMembers(db, threadId)).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect((await db.expeditions.get('d'))?.threadId).toBeNull();
    expect((await db.corrections.orderBy('at').toArray()).map(({ kind }) => kind)).toEqual([
      'thread-attach', 'thread-attach', 'thread-attach', 'thread-split', 'thread-rename', 'thread-merge', 'thread-detach', 'thread-done',
    ]);
  } finally {
    await db.delete();
  }
});
