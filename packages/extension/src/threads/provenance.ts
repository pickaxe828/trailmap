import type { Expedition, Page, Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { eligibleMetadata, recordingState, type RecordingSettings } from '../privacy/policy';

const unique = (values: string[]) => [...new Set(values)].sort();

/** Record transitive Page provenance without putting any Page text into a living-note request. */
export function notesProvenance(visits: Visit[], pages: Page[]): NonNullable<Expedition['notesSource']> {
  return {
    visitIds: unique([...visits.map(({ id }) => id), ...pages.flatMap(({ sourceVisitId, enrichmentVisitId, enrichmentSourceVisitId }) =>
      [sourceVisitId, enrichmentVisitId, enrichmentSourceVisitId].filter((id): id is string => !!id))]),
    canonicalUrls: unique([...visits.map(({ canonicalUrl }) => canonicalUrl), ...pages.flatMap(({ canonicalUrl, sourceUrl, enrichmentSourceUrl }) =>
      [canonicalUrl, sourceUrl, enrichmentSourceUrl].filter((url): url is string => !!url))]),
  };
}

/** For older or user-written notes, conservatively include every Session Visit and its Page provenance. */
export async function readNotesProvenance(db: TrailmapDb, expedition: Expedition) {
  if (expedition.notesSource) return expedition.notesSource;
  const visits = await db.visits.where('expeditionId').equals(expedition.id).toArray();
  const pages = await db.pages.bulkGet(unique(visits.map(({ canonicalUrl }) => canonicalUrl)));
  return notesProvenance(visits, pages.filter((page) => page !== undefined));
}

/** Keep the original sources of legacy notes before moving Visits between sessions. */
export async function preserveLegacyNotesSources(db: TrailmapDb, sessions: (Expedition | undefined)[]) {
  for (const session of sessions) {
    if (!session?.fieldNotes?.trim() || session.notesSource) continue;
    const source = await readNotesProvenance(db, session);
    if (source.visitIds.length) await db.expeditions.update(session.id, { notesSource: source });
  }
}

export async function allowedNotesSources(db: TrailmapDb, sources: NonNullable<Expedition['notesSource']>, settings: RecordingSettings) {
  if (settings.paused || !sources.visitIds.length || sources.canonicalUrls.some((url) => recordingState(url, settings) !== 'recording')) return false;
  const visits = await db.visits.bulkGet(sources.visitIds);
  return visits.every((visit) => visit && eligibleMetadata(visit, settings));
}
