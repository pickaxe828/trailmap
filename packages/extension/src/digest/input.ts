import type { Expedition, ModelSources } from '@trailmap/shared';
import { readConceptSources, modelProvenance } from '../ask/passages';
import { readAtlas } from '../atlas/data';
import type { TrailmapDb } from '../db/db';
import { cap } from '../enrichment/input';
import { usesMyNotes, type RecordingSettings } from '../privacy/policy';
import { allowsSources, modelSources } from '../privacy/sources';
import { allowedNotesSources, readNotesProvenance } from '../threads/provenance';
import { readThreadMembers } from '../threads/model';

export const MAX_DIGEST_EXPEDITIONS = 12;
export const MAX_DIGEST_CONCEPTS = 20;
const FIELD_NOTES_CHARS = 2_000;
const MY_NOTES_CHARS = 1_200;
const LIVING_NOTE_CHARS = 2_500;

/** Every table `readDigestInput` reads: list them all in its transaction and in the model request's guard. */
export const digestTables = (db: TrailmapDb) => [db.expeditions, db.visits, db.pages, db.threads, db.concepts, db.conceptEvidence,
  db.highlights, db.dismissedConcepts, db.edges];

export type DigestInput = {
  /** The JSON the model receives: field notes, living notes (and My notes when allowed). Never Page text. */
  input: string;
  /** What each ref in the request stands for. Anything the model returns that is not here is dropped. */
  refs: { expeditions: ReadonlyMap<string, string>; threads: ReadonlyMap<string, string>; concepts: ReadonlyMap<string, string> };
  /** Request order, used when the model names nothing usable. */
  order: { expeditions: string[]; threads: string[]; concepts: string[] };
  sources: ModelSources;
  expeditionIds: string[];
};

/**
 * The material for one digest, read from the *current* database: Expeditions that closed in `[from, to)`, learning ones with
 * field notes whose every source may go to a model right now. `undefined` means there is nothing to send (no model call).
 */
export async function readDigestInput(db: TrailmapDb, range: { from: number; to: number }, settings: RecordingSettings): Promise<DigestInput | undefined> {
  if (settings.paused) return;
  const closed = await db.expeditions.where('endedAt').between(range.from, range.to, true, false).toArray();
  const candidates = closed.filter((e) => e.kind === 'learning' && !!e.fieldNotes?.trim() && !!e.notesSource)
    .sort((a, b) => b.endedAt! - a.endedAt! || a.id.localeCompare(b.id));
  const included: Expedition[] = [];
  for (const expedition of candidates) {
    if (included.length >= MAX_DIGEST_EXPEDITIONS) break;
    const visits = (await db.visits.bulkGet(expedition.notesSource!.visitIds)).flatMap((visit) => visit ? [visit] : []);
    if (visits.length !== expedition.notesSource!.visitIds.length ||
      !allowsSources(expedition.notesSource, new Map(visits.map((visit) => [visit.id, visit])), settings)) continue;
    included.push(expedition);
  }
  if (!included.length) return;
  const expeditionRef = new Map(included.map((expedition, i) => [expedition.id, `e${i + 1}`]));
  const myNotesOk = usesMyNotes(settings);

  // A thread is shown when one of the week's Expeditions belongs to it. Its title and living note were written from every
  // noted member, so all of those sources must be sendable too, or the thread is left out (its Expeditions stay in).
  const threadEntries: { id: string; ref: string; title: string; question: string | null; livingNote?: string; expeditions: string[] }[] = [];
  const threadSources: ModelSources[] = [];
  const threadIds = [...new Set(included.flatMap(({ threadId }) => threadId ? [threadId] : []))];
  for (const threadId of threadIds) {
    const thread = await db.threads.get(threadId);
    if (!thread) continue;
    const members = await readThreadMembers(db, threadId);
    const noted = new Set(thread.notedExpeditionIds ?? []);
    const contributors = members.filter((member, i) => i === 0 || noted.has(member.id));
    const sources = modelSources([], ...await Promise.all(contributors.map((member) => readNotesProvenance(db, member))));
    if (!sources.visitIds.length || !await allowedNotesSources(db, sources, settings)) continue;
    threadSources.push(sources);
    threadEntries.push({
      id: thread.id, ref: `t${threadEntries.length + 1}`, title: cap(thread.title, 300), question: thread.question && cap(thread.question, 400),
      livingNote: thread.livingNote?.trim() ? cap(thread.livingNote.trim(), LIVING_NOTE_CHARS) : undefined,
      expeditions: included.filter((e) => e.threadId === threadId).map(({ id }) => expeditionRef.get(id)!),
    });
  }

  // New concepts: first seen this week, learned/studied or only seen, and every piece of evidence behind them sendable.
  const atlas = await readAtlas(db);
  const conceptEntries: { id: string; ref: string; name: string; strength: string }[] = [];
  const conceptVisits = [];
  const conceptExpeditions = new Set<string>();
  const fresh = [...atlas.concepts, ...atlas.seen].filter(({ firstSeen }) => firstSeen >= range.from && firstSeen < range.to)
    .sort((a, b) => Number(b.strength === 'learned') - Number(a.strength === 'learned') || a.firstSeen - b.firstSeen || a.id.localeCompare(b.id));
  for (const concept of fresh) {
    if (conceptEntries.length >= MAX_DIGEST_CONCEPTS) break;
    const found = await readConceptSources(db, concept.id, settings, myNotesOk);
    if (!found) continue;
    conceptVisits.push(...found.visits);
    for (const id of found.expeditionIds) conceptExpeditions.add(id);
    conceptEntries.push({ id: concept.id, ref: `c${conceptEntries.length + 1}`, name: cap(concept.name, 200), strength: concept.strength });
  }

  const sources = modelSources([], ...included.map(({ notesSource }) => notesSource), ...threadSources, modelProvenance(conceptVisits));
  const input = JSON.stringify({
    week: { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() },
    expeditions: included.map((expedition) => ({
      ref: expeditionRef.get(expedition.id), title: cap(expedition.title, 300), question: expedition.drivingQuestion && cap(expedition.drivingQuestion, 400),
      fieldNotes: cap(expedition.fieldNotes!, FIELD_NOTES_CHARS),
      myNotes: myNotesOk && expedition.myNotes?.trim() ? cap(expedition.myNotes.trim(), MY_NOTES_CHARS) : undefined,
    })),
    threads: threadEntries.map(({ id: _id, ...thread }) => thread),
    concepts: conceptEntries.map(({ id: _id, ...concept }) => concept),
  });
  return {
    input,
    refs: {
      expeditions: new Map([...expeditionRef].map(([id, ref]) => [ref, id])),
      threads: new Map(threadEntries.map(({ id, ref }) => [ref, id])),
      concepts: new Map(conceptEntries.map(({ id, ref }) => [ref, id])),
    },
    order: { expeditions: included.map(({ id }) => id), threads: threadEntries.map(({ id }) => id), concepts: conceptEntries.map(({ id }) => id) },
    sources, expeditionIds: [...new Set([...included.map(({ id }) => id), ...conceptExpeditions])].sort(),
  };
}
