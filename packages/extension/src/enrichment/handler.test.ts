import { expect, test } from 'bun:test';
import type { Visit } from '@trailmap/shared';
import { createCorrections } from '../corrections/corrections';
import { openTrailmapDb } from '../db/db';
import type { ModelRequester } from '../wrapup/handlers';
import { enrichPage } from './handler';

test('Page enrichment audits the parent and root, and cannot commit after their Forget', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  try {
    const visit = (id: string, parentVisitId: string | null): Visit => ({
      id, parentVisitId, url: `https://${id}.test/`, canonicalUrl: `https://${id}.test/`, title: id,
      tabId: 1, transition: 'link', startedAt: 1, activeMs: 70_000, scrollDepth: 1, engagement: 'read', expeditionId: 'e',
    });
    const current = visit('article', 'parent');
    await db.visits.bulkAdd([current, visit('parent', null), visit('root', null)]);
    await db.expeditions.add({ id: 'e', rootVisitId: 'root', title: 'Research root', drivingQuestion: null,
      kind: 'learning', startedAt: 1, endedAt: null, fieldNotes: null, userEdited: false, threadId: null });
    await db.pages.add({ canonicalUrl: current.canonicalUrl, sourceUrl: current.url, sourceVisitId: current.id, text: 'Article',
      textHash: 'hash', summary: null, takeaways: [], embedding: null, enrichedAt: null, pageKind: null });
    const job = { id: 'j', kind: 'page_enrichment' as const, key: 'key', status: 'leased' as const, createdAt: 1, availableAt: 1,
      priority: 0 as const, failures: 0, lease: { token: 'lease', until: Date.now() + 60_000 },
      payload: { canonicalUrl: current.canonicalUrl, visitId: current.id, textHash: 'hash' } };
    await db.jobs.add(job);
    const request: ModelRequester = async (_db, payload, guard) => {
      expect(await guard.allow()).toBe(true);
      expect(JSON.parse(payload.input)).toMatchObject({ parentTitle: 'parent', drivingQuestion: 'Research root' });
      expect(guard.visitIds).toEqual(['article', 'parent', 'root']);
      await createCorrections({ db, now: () => 10, newId: () => 'forget' }).forgetSite('parent.test');
      return { output: { summary: 'parent actually says…', takeaways: ['One', 'Two'], answers_question: 'Question?',
        page_kind: 'article', concepts: [], relations: [] } };
    };
    const result = await enrichPage(db, () => ({ paused: false, skippedHosts: [] }), request)(job);
    expect(typeof result).toBe('object');
    if (typeof result === 'object' && 'commit' in result) await result.commit();
    expect((await db.pages.get(current.canonicalUrl))?.summary).toBeNull();
  } finally {
    await db.delete();
  }
});
