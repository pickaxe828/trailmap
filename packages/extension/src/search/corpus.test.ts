import { expect, test } from 'bun:test';
import type { Expedition, Page, Thread, Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { observeSearchCorpus } from './corpus';
import { SearchIndex } from './index';

const url = 'https://learn.test/crdts';
const visit: Visit = {
  id: 'v', tabId: 1, url, canonicalUrl: url, title: 'Replicated lists', parentVisitId: null,
  transition: 'typed', startedAt: 1, activeMs: 100, scrollDepth: 0, engagement: 'read', expeditionId: 'e',
};
const page: Page = {
  canonicalUrl: url, text: 'Tombstones mark deleted items.', textHash: 'first', summary: null,
  takeaways: [], embedding: null, pageKind: null, enrichedAt: null, sourceVisitId: 'v',
};
const expedition: Expedition = {
  id: 'e', title: 'List research', drivingQuestion: null, kind: 'learning', startedAt: 1,
  endedAt: 3, fieldNotes: 'Broadcast operations', userEdited: false, threadId: 't',
};
const thread: Thread = {
  id: 't', title: 'Replication research', question: null, lastActiveAt: 3, status: 'active',
  livingNote: 'Combine divergent operations', centroid: null, conceptIds: [],
};

test('committed Page enrichment, note edits and deletions refresh the existing index', async () => {
  const db = openTrailmapDb(crypto.randomUUID());
  const index = new SearchIndex({ async embed() { return []; } });
  await db.transaction('rw', [db.visits, db.pages, db.expeditions, db.threads], async () => {
    await db.visits.put(visit);
    await db.pages.put(page);
    await db.expeditions.put(expedition);
    await db.threads.put(thread);
  });
  let next = Promise.withResolvers<void>();
  const subscription = observeSearchCorpus(db).subscribe({
    next: (documents) => { index.update(documents); next.resolve(); }, error: (error) => next.reject(error),
  });
  try {
    await next.promise;
    expect(index.keyword('tombstones', 5).map(({ href }) => href)).toEqual([url]);
    expect(index.keyword('broadcast', 5).map(({ href }) => href)).toEqual(['/expedition.html?id=e']);
    expect(index.keyword('divergent', 5).map(({ href }) => href)).toEqual(['/thread.html?id=t']);

    next = Promise.withResolvers<void>();
    await db.transaction('rw', [db.pages, db.expeditions, db.threads], async () => {
      await db.pages.update(url, { summary: 'An explanation of idempotence.', enrichedAt: 5 });
      await db.expeditions.update('e', { fieldNotes: 'Convergence', userEdited: true });
      await db.threads.delete('t');
    });
    await next.promise;
    expect(index.keyword('idempotence', 5).map(({ title }) => title)).toEqual(['Replicated lists']);
    expect(index.keyword('convergence', 5).map(({ title }) => title)).toEqual(['List research']);
    expect(index.keyword('broadcast divergent', 5)).toEqual([]);

    next = Promise.withResolvers<void>();
    await db.pages.delete(url);
    await next.promise;
    expect(index.keyword('tombstones idempotence', 5)).toEqual([]);
  } finally {
    subscription.unsubscribe();
    await db.delete();
  }
});
