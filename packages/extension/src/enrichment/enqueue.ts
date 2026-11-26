import type { Page, Visit } from '@trailmap/shared';
import { pendingAiTurns } from '../capture/ai-conversation';
import { googleSearchSurface } from '../capture/search';
import type { TrailmapDb } from '../db/db';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue';

/** Called in the same transaction as the captured Page or newly engaged Visit. */
export async function enqueuePageEnrichment(db: TrailmapDb, visit: Visit, now: number, storedPage?: Page) {
  if (visit.privacyBlocked || visit.engagement === 'bounced' || (!visit.aiConversation && googleSearchSurface(visit.url))) return;
  const page = storedPage ?? await db.pages.get(visit.canonicalUrl);
  if (!page?.text.trim() || !page.sourceUrl || page.enrichedAt !== null || pendingAiTurns(page).length) return;
  await enqueueJob(db, {
    kind: 'page_enrichment',
    key: JSON.stringify([page.canonicalUrl, page.textHash, page.textRevision]),
    priority: visit.engagement === 'read' ? JOB_PRIORITY.readPage : JOB_PRIORITY.skimmedPage,
    payload: { canonicalUrl: page.canonicalUrl, textHash: page.textHash, textRevision: page.textRevision, visitId: visit.id },
  }, now);
}
