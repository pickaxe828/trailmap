import { ConceptRelationType, type Expedition, type Visit } from '@trailmap/shared';
import { edgeSupport, withEdgeSupport } from '../concepts/edges';
import { summarizeConcept, type ConceptEvidence } from '../concepts/evidence';
import { readConceptEvidence, readVisibleConceptGraph } from '../concepts/read';
import type { TrailmapDb } from '../db/db';

async function expeditionsByVisit(db: TrailmapDb, visits: Visit[]) {
  const ids = [...new Set(visits.flatMap((visit) => visit.expeditionId ? [visit.expeditionId] : []))];
  const expeditions = await db.expeditions.bulkGet(ids);
  return new Map(expeditions.flatMap((expedition) => expedition ? [[expedition.id, expedition] as const] : []));
}

function isAtlasVisit(visit: Visit, expeditions: ReadonlyMap<string, Expedition>) {
  return !visit.privacyBlocked && (!visit.expeditionId || expeditions.get(visit.expeditionId)?.kind !== 'errand');
}

/** Errands cannot make a Concept visible, increase its exposure, or support an Atlas Edge. */
export function readAtlas(db: TrailmapDb) {
  return db.transaction('r', [db.concepts, db.conceptEvidence, db.visits, db.edges, db.expeditions, db.threads], async () => {
    const { concepts, edges } = await readVisibleConceptGraph(db);
    const rows = await db.conceptEvidence.where('conceptId').anyOf(concepts.map(({ id }) => id)).toArray();
    const semantic = edges.filter(({ type }) => ConceptRelationType.safeParse(type).success);
    const ids = new Set(rows.map(({ visitId }) => visitId));
    for (const edge of semantic) for (const id of edge.evidence) ids.add(id);
    const visits = (await db.visits.bulkGet([...ids])).filter((visit) => visit !== undefined);
    const expeditions = await expeditionsByVisit(db, visits);
    const allowed = new Map(visits.filter((visit) => isAtlasVisit(visit, expeditions)).map((visit) => [visit.id, visit]));
    const byConcept = new Map<string, ConceptEvidence[]>();
    const restricted = new Set<string>();
    for (const row of rows) {
      if (!allowed.has(row.visitId)) { restricted.add(row.conceptId); continue; }
      const group = byConcept.get(row.conceptId);
      if (group) group.push(row);
      else byConcept.set(row.conceptId, [row]);
    }
    const visible = concepts.flatMap((concept) => {
      const evidence = byConcept.get(concept.id);
      if (!evidence) return [];
      const scoped = restricted.has(concept.id) ? summarizeConcept(concept.id, evidence) : concept;
      return scoped && (scoped.exposure >= 2 || evidence.some((row) => row.role === 'explains' && allowed.get(row.visitId)?.engagement === 'read'))
        ? [scoped] : [];
    });
    const visibleIds = new Set(visible.map(({ id }) => id));
    const threads = (await db.threads.toArray()).map(({ id, title }) => ({ id, title, conceptIds: new Set<string>() }));
    const byThread = new Map(threads.map((thread) => [thread.id, thread.conceptIds]));
    for (const id of visibleIds) {
      for (const { visitId } of byConcept.get(id) ?? []) {
        const expeditionId = allowed.get(visitId)?.expeditionId;
        const threadId = expeditionId && expeditions.get(expeditionId)?.threadId;
        if (threadId) byThread.get(threadId)?.add(id);
      }
    }
    threads.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return { concepts: visible, threads, edges: semantic.flatMap((edge) => {
      if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return [];
      const { observed, verdicts } = edgeSupport(edge);
      const scoped = withEdgeSupport(edge, observed.filter((id) => allowed.has(id)),
        verdicts.filter((ids) => ids.every((id) => allowed.has(id))));
      return scoped.evidence.length ? [scoped] : [];
    }) };
  });
}

export function readAtlasEvidence(db: TrailmapDb, conceptId: string) {
  return db.transaction('r', [db.conceptEvidence, db.pages, db.visits, db.expeditions], async () => {
    const evidence = await readConceptEvidence(db, conceptId);
    const expeditions = await expeditionsByVisit(db, evidence.flatMap(({ visits }) => visits.map(({ visit }) => visit)));
    const used = new Map<string, Expedition>();
    const pages = evidence.flatMap(({ page, visits }) => {
      const eligible = visits.filter(({ visit }) => isAtlasVisit(visit, expeditions));
      if (!eligible.length) return [];
      for (const { visit } of eligible) {
        const expedition = visit.expeditionId ? expeditions.get(visit.expeditionId) : undefined;
        if (expedition) used.set(expedition.id, expedition);
      }
      const teacher = eligible.find(({ roles }) => roles.includes('explains'));
      return [{ url: page.canonicalUrl, title: (teacher ?? eligible[0]!).visit.title || page.canonicalUrl, taught: Boolean(teacher) }];
    });
    return {
      pages: pages.sort((a, b) => Number(b.taught) - Number(a.taught)),
      expeditions: [...used.values()].sort((a, b) => b.startedAt - a.startedAt),
    };
  });
}
