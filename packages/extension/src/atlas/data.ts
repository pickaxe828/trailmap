import { ConceptRelationType, type Expedition, type Visit } from '@trailmap/shared';
import { edgeSupport, withEdgeSupport } from '../concepts/edges';
import { notesEdgeSupport, summarizeConcept, type ConceptEvidence } from '../concepts/evidence';
import { readConceptEvidence, readVisibleConceptGraph } from '../concepts/read';
import type { TrailmapDb } from '../db/db';

async function expeditionsByVisit(db: TrailmapDb, visits: Visit[]): Promise<Map<string, Expedition>> {
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
    // Notes are anchored to the Expedition (My notes) or to a stop. Either way an errand's notes stay out of the Atlas.
    const learnedIds = [...new Set(rows.flatMap((row) => row.role === 'learned' && row.expeditionId ? [row.expeditionId] : []))];
    for (const expedition of await db.expeditions.bulkGet(learnedIds)) if (expedition) expeditions.set(expedition.id, expedition);
    const allowed = new Map(visits.filter((visit) => isAtlasVisit(visit, expeditions)).map((visit) => [visit.id, visit]));
    const learnedAnchor = (row: ConceptEvidence) => row.visitId === row.expeditionId
      ? !!row.expeditionId && !!expeditions.get(row.expeditionId) && expeditions.get(row.expeditionId)!.kind !== 'errand'
      : allowed.has(row.visitId);
    const isAllowedRow = (row: ConceptEvidence) => row.role === 'learned' ? learnedAnchor(row) : allowed.has(row.visitId);
    const allowedIds = new Set([...allowed.keys(), ...learnedIds.filter((id) => expeditions.get(id)?.kind !== 'errand').map(notesEdgeSupport)]);
    const expeditionOf = (row: ConceptEvidence) => row.role === 'learned' ? row.expeditionId : allowed.get(row.visitId)?.expeditionId;
    const byConcept = new Map<string, ConceptEvidence[]>();
    const restricted = new Set<string>();
    for (const row of rows) {
      if (!isAllowedRow(row)) { restricted.add(row.conceptId); continue; }
      const group = byConcept.get(row.conceptId);
      if (group) group.push(row);
      else byConcept.set(row.conceptId, [row]);
    }
    const visible = concepts.flatMap((concept) => {
      const evidence = byConcept.get(concept.id);
      if (!evidence) return [];
      const scoped = restricted.has(concept.id) ? summarizeConcept(concept.id, evidence) : concept;
      const learned = evidence.some((row) => row.role === 'learned');
      return scoped && (learned || scoped.exposure >= 2 || evidence.some((row) => row.role === 'explains' && allowed.get(row.visitId)?.engagement === 'read'))
        ? [{ ...scoped, learned }] : [];
    });
    const visibleIds = new Set(visible.map(({ id }) => id));
    const threads = (await db.threads.toArray()).map(({ id, title }) => ({ id, title, conceptIds: new Set<string>() }));
    const byThread = new Map(threads.map((thread) => [thread.id, thread.conceptIds]));
    for (const id of visibleIds) {
      for (const row of byConcept.get(id) ?? []) {
        const expeditionId = expeditionOf(row);
        const threadId = expeditionId && expeditions.get(expeditionId)?.threadId;
        if (threadId) byThread.get(threadId)?.add(id);
      }
    }
    threads.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return { concepts: visible, threads, edges: semantic.flatMap((edge) => {
      if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return [];
      const { observed, verdicts } = edgeSupport(edge);
      const scoped = withEdgeSupport(edge, observed.filter((id) => allowedIds.has(id)),
        verdicts.filter((ids) => ids.every((id) => allowedIds.has(id))));
      return scoped.evidence.length ? [scoped] : [];
    }) };
  });
}

export function readAtlasEvidence(db: TrailmapDb, conceptId: string) {
  return db.transaction('r', [db.conceptEvidence, db.pages, db.visits, db.expeditions], async () => {
    const evidence = await readConceptEvidence(db, conceptId);
    const expeditions = await expeditionsByVisit(db, evidence.flatMap(({ visits }) => visits.map(({ visit }) => visit)));
    const used = new Map<string, Expedition>();
    // My notes and stop notes that taught this concept; their Expeditions are listed even with no evidence Page.
    const learnedRows = await db.conceptEvidence.where('conceptId').equals(conceptId).filter((row) => row.role === 'learned').toArray();
    const written = (await db.expeditions.bulkGet([...new Set(learnedRows.flatMap(({ expeditionId }) => expeditionId ? [expeditionId] : []))]))
      .filter((expedition) => !!expedition && expedition.kind !== 'errand');
    for (const expedition of written) used.set(expedition!.id, expedition!);
    const pages = evidence.flatMap(({ page, visits }) => {
      const eligible = visits.filter(({ visit }) => isAtlasVisit(visit, expeditions));
      if (!eligible.length) return [];
      for (const { visit } of eligible) {
        const expedition = visit.expeditionId ? expeditions.get(visit.expeditionId) : undefined;
        if (expedition) used.set(expedition.id, expedition);
      }
      const teacher = eligible.find(({ roles }) => roles.includes('explains'));
      const { visit } = teacher ?? eligible[0]!;
      return [{ url: page.canonicalUrl, title: visit.title || page.canonicalUrl, taught: Boolean(teacher),
        aiStop: visit.aiConversation ? { visitId: visit.id, expeditionId: visit.expeditionId } : undefined,
      }];
    });
    return {
      learned: written.length > 0,
      pages: pages.sort((a, b) => Number(b.taught) - Number(a.taught)),
      expeditions: [...used.values()].sort((a, b) => b.startedAt - a.startedAt),
    };
  });
}
