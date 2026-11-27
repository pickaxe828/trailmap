import { expect, test } from 'bun:test';
import { forgetCascade } from '../corrections/forget';
import { openTrailmapDb } from '../db/db';
import { newThread } from '../threads/model';
import { notePath } from '../vault/notes';
import { readMarkdownNotes } from '../vault/data';

test('each digest is exported as a note linking to its Expedition and Thread notes, and it leaves the vault when it is forgotten', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  try {
    const url = 'https://learn.test/a';
    await db.visits.add({ id: 'v', tabId: 1, url, canonicalUrl: url, title: 't', parentVisitId: null, transition: 'link', startedAt: 10, activeMs: 70_000, scrollDepth: 1, engagement: 'read', expeditionId: 'e' });
    await db.expeditions.add({ id: 'e', title: 'Replicas', drivingQuestion: null, kind: 'learning', startedAt: 10, endedAt: 20, userEdited: false, threadId: 't',
      fieldNotes: '## Loose ends\n\n- Check the proof\n', notesSource: { visitIds: ['v'], canonicalUrls: [url] } });
    await db.threads.add({ ...newThread('t', 20), title: 'Replication' });
    await db.digests.add({ id: 'week-1970-01-01', kind: 'week', from: 0, to: 100, generatedAt: 50, summary: 'A quiet week on replicas.', expeditions: [{ id: 'e', why: 'Central.' }],
      threads: [{ id: 't', why: 'Moved.' }], conceptIds: [], pickingUp: ['t'], sources: { visitIds: ['v'], canonicalUrls: [url] }, expeditionIds: ['e'] });
    const note = (await readMarkdownNotes(db)).find(({ path }) => path.startsWith('trailmap-digest-'))!;
    expect(note.path).toBe(await notePath('digest', 'week-1970-01-01'));
    expect(note.markdown).toContain('kind: "digest"');
    expect(note.markdown).toContain('A quiet week on replicas.');
    expect(note.markdown).toContain(`[[${(await notePath('expedition', 'e')).replace('.md', '')}|Replicas]] — Central.`);
    expect(note.markdown).toContain(`[[${(await notePath('thread', 't')).replace('.md', '')}|Replication]] — Moved.`);
    expect(note.markdown).toContain('Check the proof');
    await forgetCascade(db, { kind: 'forget-expedition', visitIds: ['v'], expeditionIds: ['e'], now: () => 99, newId: () => crypto.randomUUID(), quiet: true });
    expect((await readMarkdownNotes(db)).some(({ path }) => path.startsWith('trailmap-digest-'))).toBe(false);
  } finally { await db.delete(); }
});
