import type { EvidenceStrength } from '../concepts/strength';
import { readAtlas } from '../atlas/data';
import type { TrailmapDb } from '../db/db';
import { readLooseEnds, type LooseEnd } from './loose-ends';
import type { Digest } from './types';

export type DigestView = Pick<Digest, 'id' | 'kind' | 'from' | 'to' | 'generatedAt' | 'summary'> & {
  expeditions: { id: string; title: string; why: string }[];
  threads: { id: string; title: string; why: string }[];
  concepts: { id: string; name: string; strength: EvidenceStrength }[];
  looseEnds: (LooseEnd & { expeditionTitle: string })[];
  pickingUp: { id: string; title: string }[];
};

export const MAX_LOOSE_ENDS = 12;

/**
 * Digests, newest first. Only the model's words are stored: every title, link, concept strength and loose end is read now, and an
 * item whose Expedition, thread or concept has since gone (merged, deleted, dismissed) is simply not shown.
 */
export function readDigests(db: TrailmapDb): Promise<DigestView[]> {
  return db.transaction('r', [db.digests, db.expeditions, db.threads, db.concepts, db.conceptEvidence, db.visits, db.highlights, db.dismissedConcepts, db.edges], async () => {
    const digests = await db.digests.orderBy('to').reverse().toArray();
    if (!digests.length) return [];
    const atlas = await readAtlas(db);
    const concepts = new Map([...atlas.concepts, ...atlas.seen].map((concept) => [concept.id, concept]));
    const views: DigestView[] = [];
    for (const digest of digests) {
      const [expeditions, threads, pickingUp, sources] = await Promise.all([
        db.expeditions.bulkGet(digest.expeditions.map(({ id }) => id)), db.threads.bulkGet(digest.threads.map(({ id }) => id)),
        db.threads.bulkGet(digest.pickingUp), db.expeditions.bulkGet(digest.expeditionIds)]);
      const looseEnds = sources.flatMap((expedition) => expedition && expedition.endedAt !== null && expedition.endedAt >= digest.from && expedition.endedAt < digest.to
        ? readLooseEnds(expedition).map((end) => ({ ...end, expeditionTitle: expedition.title })) : []);
      views.push({
        id: digest.id, kind: digest.kind, from: digest.from, to: digest.to, generatedAt: digest.generatedAt, summary: digest.summary,
        expeditions: digest.expeditions.flatMap(({ why }, i) => expeditions[i] ? [{ id: expeditions[i]!.id, title: expeditions[i]!.title, why }] : []),
        threads: digest.threads.flatMap(({ why }, i) => threads[i] ? [{ id: threads[i]!.id, title: threads[i]!.title, why }] : []),
        concepts: digest.conceptIds.flatMap((id) => concepts.get(id) ? [{ id, name: concepts.get(id)!.name, strength: concepts.get(id)!.strength }] : []),
        looseEnds: looseEnds.slice(0, MAX_LOOSE_ENDS),
        pickingUp: pickingUp.flatMap((thread) => thread && thread.status !== 'done' ? [{ id: thread.id, title: thread.title }] : []),
      });
    }
    return views;
  });
}

/** What the Journal's digest section shows: the digests and whether a digest job is queued or running. */
export async function readDigestPanel(db: TrailmapDb) {
  const [digests, working] = await Promise.all([readDigests(db),
    db.jobs.where('status').anyOf('pending', 'leased').filter(({ kind }) => kind === 'weekly_digest').count()]);
  return { digests, working: working > 0 };
}
