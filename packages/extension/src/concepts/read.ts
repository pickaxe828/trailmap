import { ConceptRelationType } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import type { ConceptEvidencePage } from './evidence';
import { summarizeStrength } from './strength';
import { loadStrengthContext } from './strength-read';

/** Where did I learn this? One result per canonical Page, preserving the evidence Visits and their roles. */
export async function readConceptEvidence(db: TrailmapDb, conceptId: string): Promise<ConceptEvidencePage[]> {
  return (await readConceptEvidenceBatch(db, [conceptId])).get(conceptId) ?? [];
}

/** Fetch evidence in batches when projecting more than one Concept, without a query per note. */
export function readConceptEvidenceBatch(db: TrailmapDb, conceptIds: string[]): Promise<Map<string, ConceptEvidencePage[]>> {
  return db.transaction('r', db.conceptEvidence, db.pages, db.visits, async () => {
    const rows = await db.conceptEvidence.where('conceptId').anyOf(conceptIds).sortBy('startedAt');
    const urls = [...new Set(rows.map((row) => row.canonicalUrl))];
    const ids = [...new Set(rows.map((row) => row.visitId))];
    const [pages, visits] = await Promise.all([db.pages.bulkGet(urls), db.visits.bulkGet(ids)]);
    const byUrl = new Map(pages.flatMap((page) => page ? [[page.canonicalUrl, page] as const] : []));
    const byVisit = new Map(visits.flatMap((visit) => visit ? [[visit.id, visit] as const] : []));
    type EvidenceVisits = Map<string, ConceptEvidencePage['visits'][number]>;
    const grouped = new Map<string, Map<string, EvidenceVisits>>();
    const getOrCreate = <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
      const existing = map.get(key);
      if (existing !== undefined) return existing;
      const value = create();
      map.set(key, value);
      return value;
    };
    for (const { conceptId, canonicalUrl, visitId, role } of rows) {
      const visit = byVisit.get(visitId);
      if (!visit || !byUrl.has(canonicalUrl)) continue;
      const pages = getOrCreate(grouped, conceptId, () => new Map());
      const visits = getOrCreate(pages, canonicalUrl, () => new Map());
      const entry = getOrCreate(visits, visitId, (): ConceptEvidencePage['visits'][number] => ({ visit, roles: [] }));
      if (!entry.roles.includes(role)) entry.roles.push(role);
    }
    return new Map([...grouped].map(([id, pages]) => [id, [...pages].map(([url, visits]) => ({
      page: byUrl.get(url)!, visits: [...visits.values()],
    }))]));
  });
}

/** PLAN §4.5: a concept is visible when it is learned or studied and the user has not said they did not learn it. */
export function readVisibleConcepts(db: TrailmapDb) {
  return db.transaction('r', [db.concepts, db.conceptEvidence, db.visits, db.highlights, db.dismissedConcepts], async () => {
    const rows = await db.conceptEvidence.toArray();
    const context = await loadStrengthContext(db, rows);
    const dismissals = new Map((await db.dismissedConcepts.toArray()).map((row) => [row.conceptId, row]));
    const byConcept = new Map<string, typeof rows>();
    for (const row of rows) byConcept.set(row.conceptId, [...byConcept.get(row.conceptId) ?? [], row]);
    const visible = new Set([...byConcept].filter(([id, evidence]) => {
      const { strength, dismissed } = summarizeStrength(evidence, context, dismissals.get(id));
      return strength !== 'seen' && !dismissed;
    }).map(([id]) => id));
    return db.concepts.filter((c) => visible.has(c.id)).toArray();
  });
}

/** Atlas-ready projection. Bridge edges start at a Visit ID, semantic edges at a Concept ID. */
export function readVisibleConceptGraph(db: TrailmapDb) {
  return db.transaction('r', [db.concepts, db.conceptEvidence, db.visits, db.highlights, db.dismissedConcepts, db.edges], async () => {
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
    const rows = [...await db.conceptEvidence.where('visitId').anyOf(visitIds).toArray(),
      ...await db.conceptEvidence.where('expeditionId').equals(expeditionId).filter((row) => !visitIds.includes(row.visitId)).toArray()];
    const pagesByConcept = new Map<string, Set<string>>();
    for (const row of rows) {
      const pages = pagesByConcept.get(row.conceptId) ?? new Set<string>();
      pages.add(row.role === 'learned' ? `notes:${row.id}` : row.canonicalUrl);
      pagesByConcept.set(row.conceptId, pages);
    }
    const concepts = (await db.concepts.bulkGet([...pagesByConcept.keys()])).filter((c) => c !== undefined);
    return concepts.sort((a, b) => pagesByConcept.get(b.id)!.size - pagesByConcept.get(a.id)!.size || a.name.localeCompare(b.name))
      .slice(0, Math.max(0, limit));
  });
}
