import type { Page } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue';
import type { JobSpec } from '../jobs/types';

export function conceptResolutionJob(page: Page): JobSpec<'concept_resolution'> | undefined {
  const { canonicalUrl, enrichmentVisitId: visitId, enrichedAt, textHash, textRevision } = page;
  if (!visitId || enrichedAt === null || !page.conceptMentions?.length) return;
  return {
    kind: 'concept_resolution', priority: JOB_PRIORITY.conceptResolution,
    key: JSON.stringify([canonicalUrl, visitId, enrichedAt, textRevision]),
    payload: { canonicalUrl, visitId, enrichedAt, textHash, textRevision },
  };
}

export async function enqueueConceptResolution(db: TrailmapDb, page: Page, now: number) {
  const job = conceptResolutionJob(page);
  if (job) await enqueueJob(db, job, now);
}
