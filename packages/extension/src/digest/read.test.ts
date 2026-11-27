import { expect, test } from 'bun:test';
import { openTrailmapDb } from '../db/db';
import { newThread } from '../threads/model';
import { readDigests } from './read';

test('digests are listed newest first with titles, loose ends and picking-up read live; vanished items are not shown', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  try {
    const base = { kind: 'week' as const, generatedAt: 1, summary: 'S', conceptIds: [], pickingUp: ['dormant', 'gone'], sources: { visitIds: [], canonicalUrls: [] } };
    await db.digests.bulkAdd([
      { ...base, id: 'week-old', from: 0, to: 100, expeditions: [], threads: [], expeditionIds: [], pickingUp: [] },
      { ...base, id: 'week-new', from: 100, to: 200, expeditions: [{ id: 'e1', why: 'Why one' }, { id: 'merged-away', why: 'x' }], threads: [{ id: 't1', why: 'Why thread' }], expeditionIds: ['e1'] },
    ]);
    await db.expeditions.add({ id: 'e1', title: 'Live title', drivingQuestion: null, kind: 'learning', startedAt: 100, endedAt: 150, userEdited: false, threadId: 't1',
      fieldNotes: '## Loose ends\n\n- Check proofs\n', unreadStops: [{ visitId: 'v', title: 'Open tab', url: 'https://t.test/' }] });
    await db.threads.bulkAdd([{ ...newThread('t1', 150), title: 'Thread title' }, { ...newThread('dormant', 150), title: 'Dormant thread', status: 'dormant' }]);
    const [newest, oldest] = await readDigests(db);
    expect([newest!.id, oldest!.id]).toEqual(['week-new', 'week-old']);
    expect(newest!.expeditions).toEqual([{ id: 'e1', title: 'Live title', why: 'Why one' }]);
    expect(newest!.threads).toEqual([{ id: 't1', title: 'Thread title', why: 'Why thread' }]);
    expect(newest!.looseEnds.map(({ text }) => text)).toEqual(['Opened but never read: Open tab', 'Check proofs']);
    expect(newest!.pickingUp).toEqual([{ id: 'dormant', title: 'Dormant thread' }]);
  } finally { await db.delete(); }
});
