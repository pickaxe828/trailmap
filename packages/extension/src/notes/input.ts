import type { Expedition, Note, Query, Visit } from '@trailmap/shared';
import { cap } from '../enrichment/input';
import { eligibleMetadata, usesMyNotes, type RecordingSettings } from '../privacy/policy';
import { modelSources } from '../privacy/sources';

const MAX_STOP_NOTES = 40;
const NOTE_BYTES = 6_000;

export type NotesSources = { expedition: Expedition; visits: Visit[]; queries: Query[]; notes: Note[] };

const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** What the user wrote about an Expedition: its My notes and the notes on its stops, in trail order. */
export function collectMyNotes({ expedition, visits, queries, notes }: NotesSources) {
  const visitOf = new Map(visits.map((visit) => [visit.id, visit]));
  const queryVisit = new Map(queries.flatMap((query) => query.visitId ? [[query.id, query.visitId] as const] : []));
  const stops = notes.flatMap((note) => {
    const visit = visitOf.get(queryVisit.get(note.nodeId) ?? note.nodeId);
    return visit && note.text.trim() ? [{ visit, text: note.text.trim() }] : [];
  }).sort((a, b) => a.visit.startedAt - b.visit.startedAt || a.visit.id.localeCompare(b.visit.id));
  return { mine: expedition.myNotes?.trim() ?? '', stops };
}

/**
 * The `notes_enrichment` request (PLAN §4.5a). The user's own text only: no Page text. It exists only when the
 * "Use my notes" setting is on and recording is not paused; notes on a skipped or private stop never leave.
 */
export function buildNotesInput(sources: NotesSources, settings: RecordingSettings) {
  if (settings.paused || !usesMyNotes(settings)) return;
  const { mine, stops } = collectMyNotes(sources);
  const entries: { ref: string; anchorId: string; text: string; visit?: Visit }[] = [];
  if (mine) entries.push({ ref: 'n0', anchorId: sources.expedition.id, text: cap(mine, NOTE_BYTES) });
  for (const { visit, text } of stops) {
    if (entries.length > MAX_STOP_NOTES) break;
    if (eligibleMetadata(visit, settings)) entries.push({ ref: `n${entries.length + (mine ? 0 : 1)}`, anchorId: visit.id, text: cap(text, NOTE_BYTES), visit });
  }
  if (!entries.length) return;
  const input = JSON.stringify({ notes: entries.map(({ ref, text }) => ({ ref, text })) });
  return {
    input,
    digest: hash(input),
    anchors: new Map(entries.map(({ ref, anchorId }) => [ref, anchorId])),
    provenance: modelSources(entries.flatMap(({ visit }) => visit ? [visit] : [])),
  };
}

/** Anything written, whether or not it can be sent. A change here is what reruns the model task. */
export const hasMyNotes = (sources: NotesSources) => {
  const { mine, stops } = collectMyNotes(sources);
  return !!mine || stops.length > 0;
};
