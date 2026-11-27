import type { TrailmapDb } from '../db/db';
import { quantize, type Embedder } from '../embeddings/embedder';
import type { JobHandlers } from '../jobs/queue';
import type { JobPayloads } from '../jobs/types';
import { putObservedEdge } from './edges';
import { matchConcept } from './match';
import { conceptNameKey, isConceptName, refreshConcept } from './evidence';
import { enqueueMergeVerdicts } from './verdicts';

export function resolveConcepts(db: TrailmapDb, embedder: Embedder, now: () => number): JobHandlers['concept_resolution'] {
  async function source(payload: JobPayloads['concept_resolution']) {
    const [page, visit] = await Promise.all([db.pages.get(payload.canonicalUrl), db.visits.get(payload.visitId)]);
    if (!visit || visit.privacyBlocked || visit.canonicalUrl !== payload.canonicalUrl || !page ||
        page.enrichmentVisitId !== visit.id || page.enrichedAt !== payload.enrichedAt ||
        page.textHash !== payload.textHash || page.textRevision !== payload.textRevision) return;
    const sourceUrl = page.enrichmentSourceUrl ?? page.sourceUrl;
    const sourceVisitId = page.enrichmentSourceUrl ? page.enrichmentSourceVisitId : page.sourceVisitId;
    if (sourceVisitId && sourceVisitId !== visit.id) {
      const sourceVisit = await db.visits.get(sourceVisitId);
      if (!sourceVisit || sourceVisit.privacyBlocked) return;
    }
    return { page, visit, sourceUrl, sourceVisitId };
  }

  return async ({ payload }) => {
    const input = await db.transaction('r', db.visits, db.pages, () => source(payload));
    if (!input) return 'discard';
    const mentions = (input.page.conceptMentions ?? []).map((m) => ({ ...m, name: m.name.trim(), gloss: m.gloss.trim() }))
      .filter((m) => isConceptName(conceptNameKey(m.name)));
    const embeddings = mentions.length ? await embedder.embed(mentions.map(({ name, gloss }) => `${name}\n${gloss}`)).catch(() => undefined) : [];
    if (!embeddings || embeddings.length !== mentions.length) return { retryAt: now() + 30_000 };
    return { commit: async () => {
      const current = await source(payload);
      if (!current) return;
      const { visit } = current;
      const known = await db.concepts.toArray();
      const byName = new Map(known.flatMap((c) => [c.name, ...c.aliases].map((name) => [conceptNameKey(name), c.id] as const)));
      const candidates = new Map(known.map((c) => [c.id, c.embedding]));
      const representatives = new Map<string, string>();
      const pairs: JobPayloads['merge_verdict']['pairs'] = [];
      const onPage = new Map<string, string>();
      const taught = new Map<string, boolean>();
      for (const [i, mention] of mentions.entries()) {
        const key = conceptNameKey(mention.name);
        const vector = embeddings[i]!;
        const { conceptId: matched, uncertain } = matchConcept(key, vector, byName, candidates);
        const conceptId = matched ?? crypto.randomUUID();
        byName.set(key, conceptId);
        onPage.set(key, conceptId);
        taught.set(conceptId, !!taught.get(conceptId) || mention.role === 'explains');
        const embedding = quantize(vector);
        const evidenceId = crypto.randomUUID();
        if (!candidates.has(conceptId)) {
          candidates.set(conceptId, embedding);
          representatives.set(conceptId, evidenceId);
        }
        await db.conceptEvidence.add({
          ...mention, id: evidenceId, conceptId, visitId: visit.id, canonicalUrl: visit.canonicalUrl,
          sourceUrl: current.sourceUrl, sourceVisitId: current.sourceVisitId, enrichmentSources: current.page.enrichmentSources,
          startedAt: visit.startedAt, embedding,
        });
        if (uncertain) {
          const existing = known.find((c) => c.id === uncertain);
          const existingId = representatives.get(uncertain) ?? (existing && await db.conceptEvidence.where('conceptId').equals(uncertain)
            .filter((row) => row.name === existing.name && row.gloss === existing.gloss && row.startedAt === existing.firstSeen).first())?.id;
          if (existingId) pairs.push({ candidateId: evidenceId, existingId });
        }
      }
      for (const [id, explains] of taught) {
        await refreshConcept(db, id);
        await putObservedEdge(db, visit.id, id, explains ? 'teaches' : 'mentions', visit.id);
      }
      for (const relation of current.page.relationMentions ?? []) {
        const from = onPage.get(conceptNameKey(relation.from));
        const to = onPage.get(conceptNameKey(relation.to));
        if (from && to) await putObservedEdge(db, from, to, relation.type, visit.id);
      }
      await enqueueMergeVerdicts(db, pairs, now());
    } };
  };
}
