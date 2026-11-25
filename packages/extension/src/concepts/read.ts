import { ConceptRelationType } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import type { ConceptEvidencePage } from './evidence';

/** Where did I learn this? One result per canonical Page, preserving the evidence Visits and their roles. */
export function readConceptEvidence(db: TrailmapDb, conceptId: string): Promise<ConceptEvidencePage[]> {
  return db.transaction('r', db.conceptEvidence, db.pages, db.visits, async () => {
    const rows = await db.conceptEvidence.where('conceptId').equals(conceptId).sortBy('startedAt');
    const urls = [...new Set(rows.map((row) => row.canonicalUrl))];
    const ids = [...new Set(rows.map((row) => row.visitId))];
    const [pages, visits] = await Promise.all([db.pages.bulkGet(urls), db.visits.bulkGet(ids)]);
    const byVisit = new Map(visits.flatMap((visit) => visit ? [[visit.id, visit] as const] : []));
    return pages.flatMap((page) => {
      if (!page) return [];
      const grouped = new Map<string, ConceptEvidencePage['visits'][number]>();
      for (const row of rows) {
        const visit = byVisit.get(row.visitId);
        if (!visit || row.canonicalUrl !== page.canonicalUrl) continue;
        const entry = grouped.get(visit.id) ?? { visit, roles: [] };
        if (!entry.roles.includes(row.role)) entry.roles.push(row.role);
        grouped.set(visit.id, entry);
      }
      return grouped.size ? [{ page, visits: [...grouped.values()] }] : [];
    });
  });
}

/** Visibility uses current engagement: a Visit may become read after it was enriched. */
export function readVisibleConcepts(db: TrailmapDb) {
  return db.transaction('r', db.concepts, db.conceptEvidence, db.visits, async () => {
    const explained = await db.conceptEvidence.filter((row) => row.role === 'explains').toArray();
    const visits = await db.visits.bulkGet([...new Set(explained.map((row) => row.visitId))]);
    const read = new Set(visits.flatMap((visit) => visit?.engagement === 'read' ? [visit.id] : []));
    const taught = new Set(explained.filter((row) => read.has(row.visitId)).map((row) => row.conceptId));
    return db.concepts.filter((c) => c.exposure >= 2 || taught.has(c.id)).toArray();
  });
}

/** Atlas-ready projection. Bridge edges start at a Visit ID, semantic edges at a Concept ID. */
export function readVisibleConceptGraph(db: TrailmapDb) {
  return db.transaction('r', [db.concepts, db.conceptEvidence, db.visits, db.edges], async () => {
    const concepts = await readVisibleConcepts(db);
    const visible = new Set(concepts.map((c) => c.id));
    const edges = await db.edges.where('to').anyOf([...visible]).filter((edge) => edge.evidence.length > 0 &&
      (edge.type === 'teaches' || edge.type === 'mentions' || (ConceptRelationType.safeParse(edge.type).success && visible.has(edge.from))))
      .toArray();
    return { concepts, edges };
  });
}

/** Rank by distinct evidence Pages in the Expedition, using current Visit membership. */
export function readExpeditionTopConcepts(db: TrailmapDb, expeditionId: string, limit = 5) {
  return db.transaction('r', [db.visits, db.conceptEvidence, db.concepts], async () => {
    const visitIds = await db.visits.where('expeditionId').equals(expeditionId).primaryKeys();
    const rows = await db.conceptEvidence.where('visitId').anyOf(visitIds).toArray();
    const pagesByConcept = new Map<string, Set<string>>();
    for (const row of rows) {
      const pages = pagesByConcept.get(row.conceptId) ?? new Set<string>();
      pages.add(row.canonicalUrl);
      pagesByConcept.set(row.conceptId, pages);
    }
    const concepts = (await db.concepts.bulkGet([...pagesByConcept.keys()])).filter((c) => c !== undefined);
    return concepts.sort((a, b) => pagesByConcept.get(b.id)!.size - pagesByConcept.get(a.id)!.size || a.name.localeCompare(b.name))
      .slice(0, Math.max(0, limit));
  });
}
