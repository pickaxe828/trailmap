import { join } from 'node:path';
import type { Expedition, Page, Thread, Visit } from '../packages/shared/src/domain';
import { expect, seedCapture, test } from './fixtures';

const day = 86_400_000;
const crdtDimension = 63; // The harness Embedder's vector for the CRDT topic.

for (const age of [4, 0.25]) {
  test(`a matching search ${age >= 1 ? 'picks up a dormant Thread and marks revisits' : 'does not pick up an active Thread'}`, async ({
    context, openExtensionPage, fixtureUrl, readCapture,
  }, info) => {
    const setup = await openExtensionPage('sidepanel.html');
    const canonicalUrl = fixtureUrl('learn.test', '/replica-primer.html');
    const searchUrl = 'https://www.google.com/search?q=crdt+deletes';
    await context.route(searchUrl, (route) => route.fulfill({ contentType: 'text/html', body:
      `<title>CRDT deletes</title><a href="${canonicalUrl}">Replica primer</a>` }));
    await context.route(canonicalUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Replica primer</title>' }));
    const lastActiveAt = Date.now() - age * day;
    const centroid = new Int8Array(384);
    centroid[crdtDimension] = 127;
    const thread: Thread = { id: 'replicas', title: 'Replicated lists', question: null, status: 'active', lastActiveAt,
      centroid, conceptIds: [], livingNote: null };
    const fieldNotes = '## Question\n\nHow do deletes converge?\n\n## What you found\n\nTombstones keep deletes visible.\n\n' +
      '## Key ideas\n\n- A tombstone is a marker.\n\n## Loose ends\n\n- Check when tombstones can be collected.';
    const expeditions: Expedition[] = [1, 0].map((days) => ({
      id: `session-${days}`, title: 'Replicated deletes', startedAt: lastActiveAt - days * day - 120_000,
      endedAt: lastActiveAt - days * day, drivingQuestion: null, kind: 'learning', fieldNotes: days ? null : fieldNotes,
      userEdited: false, threadId: thread.id,
    }));
    const visit: Visit = { id: 'prior-read', title: 'Replica primer', canonicalUrl, url: canonicalUrl, tabId: 1,
      expeditionId: 'session-0', startedAt: lastActiveAt - 100_000, parentVisitId: null, transition: 'link',
      engagement: 'read', scrollDepth: 1, activeMs: 75_000 };
    const page: Page = { canonicalUrl, text: '', textHash: '', summary: 'Replicas use markers to retain deletions.',
      takeaways: [], embedding: null, pageKind: 'article', enrichedAt: lastActiveAt - 10_000 };
    await seedCapture(setup, { threads: [thread], expeditions, visits: [visit], pages: [page] });

    const panel = await openExtensionPage('sidepanel.html');
    await panel.setViewportSize({ width: 480, height: 920 });
    const tab = await context.newPage();
    await tab.goto(searchUrl);
    await tab.bringToFront();
    await expect(panel.getByRole('heading', { name: 'crdt deletes', exact: true })).toBeVisible();
    await expect(panel.getByText('You are here', { exact: true })).toBeVisible();
    await expect.poll(async () => (await readCapture('visits')).find(({ url }) => url === searchUrl)?.expeditionEmbedding?.[crdtDimension]).toBe(127);
    const heading = panel.getByRole('heading', { name: /^Picking up:/ });
    if (age < 1) {
      await expect(heading).toHaveCount(0);
      return;
    }
    await expect(heading).toHaveText('Picking up: Replicated lists (last session 4 days ago)');
    await expect(panel.getByText('Tombstones keep deletes visible.')).toBeVisible();
    await expect(panel.getByText('Check when tombstones can be collected.')).toBeVisible();
    await expect(panel.getByText(/^Read on /)).toHaveCount(0);

    await tab.getByRole('link', { name: 'Replica primer' }).click();
    const current = panel.getByRole('treeitem').filter({ hasText: 'Replica primer' }).last();
    await expect(current.getByText(/^Read on /)).toHaveText(`Read on ${new Intl.DateTimeFormat(undefined,
      { month: 'short', day: 'numeric' }).format(visit.startedAt)}`);
    await expect(current.getByText('Replicas use markers to retain deletions.')).toBeVisible();
    await panel.screenshot({ path: join(process.env.PROOF_DIR ?? info.outputDir, 'picking-up.png') });
  });
}
