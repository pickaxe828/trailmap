import type { Expedition, FieldNotesDraft, Highlight, Page, Query, Visit } from '@trailmap/shared';
import { cap } from '../enrichment/input';
import { maySendToModel, recordingState, type RecordingSettings } from '../privacy/policy';

const MAX_PAGES = 50;
const MAX_UNREAD = 20;

export type TrailSources = {
  expedition: Expedition;
  visits: Visit[];
  pages: Page[];
  highlights: Highlight[];
  queries: Query[];
  /** Visits that supplied Page text, for the password screen in `maySendToModel`. */
  sourceVisits: Visit[];
};

export type SameDay = { expedition: Expedition; root: Visit | undefined };

type SearchEntry = { ref: string; q: string; cameFrom: string | null };
type PageEntry = {
  ref: string; title: string; url: string; engagement: Visit['engagement']; cameFrom: string | null;
  summary: string | null; takeaways: string[]; highlights: string[];
};
export type TrailEntry = SearchEntry | PageEntry;
type Link = { title: string; url: string };

const hostOf = (url: string) => URL.parse(url)?.hostname ?? url;
const byTime = (a: Visit, b: Visit) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);

/** Navigation metadata is only usable from a Visit that is recordable now. */
function allowed(visit: Visit | undefined, settings: RecordingSettings): visit is Visit {
  return !!visit && !visit.privacyBlocked && recordingState(visit.url, settings) === 'recording' &&
    recordingState(visit.canonicalUrl, settings) === 'recording';
}

/**
 * The model-visible trail of an Expedition, in the order it happened, plus the
 * tabs that were opened but never read. Bounced Visits never reach the model;
 * they only become local loose ends.
 */
export function collectTrail({ visits, pages, highlights, queries, sourceVisits }: TrailSources, settings: RecordingSettings) {
  const ordered = [...visits].sort(byTime);
  const pageByUrl = new Map(pages.map((page) => [page.canonicalUrl, page]));
  const sourceById = new Map(sourceVisits.map((visit) => [visit.id, visit]));
  const queryByVisit = new Map(queries.flatMap((query) => query.visitId ? [[query.visitId, query] as const] : []));
  const refOfVisit = new Map<string, string>();
  const refOfUrl = new Map<string, string>();
  const picked: { visit: Visit; page?: Page; query?: Query }[] = [];

  for (const visit of ordered) {
    const query = queryByVisit.get(visit.id);
    if (query) {
      if (allowed(visit, settings) && query.q.trim()) picked.push({ visit, query });
      continue;
    }
    const page = pageByUrl.get(visit.canonicalUrl);
    const source = page?.sourceVisitId ? sourceById.get(page.sourceVisitId) : undefined;
    if (!maySendToModel(visit, page, settings, source)) continue;
    if (!picked.some((entry) => entry.page && entry.visit.canonicalUrl === visit.canonicalUrl)) picked.push({ visit, page });
  }

  // Keep the budget for Pages the user actually read, but retain trail order.
  const pagePicks = picked.filter(({ page }) => page);
  const dropped = new Set(pagePicks.length > MAX_PAGES
    ? [...pagePicks].sort((a, b) => Number(b.visit.engagement === 'read') - Number(a.visit.engagement === 'read')).slice(MAX_PAGES)
    : []);

  let pageCount = 0;
  let queryCount = 0;
  const entries: TrailEntry[] = [];
  for (const pick of picked) {
    if (dropped.has(pick)) continue;
    const ref = pick.query ? `q${++queryCount}` : `p${++pageCount}`;
    refOfVisit.set(pick.visit.id, ref);
    if (pick.page) refOfUrl.set(pick.visit.canonicalUrl, ref);
  }
  const byId = new Map(visits.map((candidate) => [candidate.id, candidate]));
  const cameFrom = (visit: Visit) => {
    // Nearest included ancestor, so a bounced hop doesn't break the story.
    for (let parent = visit.parentVisitId ? byId.get(visit.parentVisitId) : undefined, hops = 0; parent && hops < 100;
      parent = parent.parentVisitId ? byId.get(parent.parentVisitId) : undefined, hops++) {
      const ref = refOfVisit.get(parent.id) ?? refOfUrl.get(parent.canonicalUrl);
      if (ref && ref !== refOfVisit.get(visit.id)) return ref;
    }
    return null;
  };

  for (const pick of picked) {
    if (dropped.has(pick)) continue;
    const { visit, page, query } = pick;
    const ref = refOfVisit.get(visit.id)!;
    if (query) {
      entries.push({ ref, q: cap(query.q, 768), cameFrom: cameFrom(visit) });
      continue;
    }
    const sameUrl = new Set(visits.filter((candidate) => candidate.canonicalUrl === visit.canonicalUrl).map(({ id }) => id));
    const enriched = page!.enrichedAt !== null && page!.summary;
    entries.push({
      ref, title: cap(visit.title || hostOf(visit.canonicalUrl), 768), url: visit.canonicalUrl,
      engagement: visit.engagement, cameFrom: cameFrom(visit),
      summary: enriched ? cap(page!.summary!, 1500) : null,
      takeaways: enriched ? page!.takeaways.slice(0, 5).map((takeaway) => cap(takeaway, 600)) : [],
      highlights: highlights.filter((item) => sameUrl.has(item.visitId) && (!item.canonicalUrl || item.canonicalUrl === visit.canonicalUrl))
        .slice(0, 5).map(({ text }) => cap(text, 800)),
    });
  }

  const unread: Link[] = [];
  const seen = new Set<string>(entries.flatMap((entry) => 'url' in entry ? [entry.url] : []));
  for (const visit of ordered) {
    if (visit.engagement !== 'bounced' || queryByVisit.has(visit.id) || !allowed(visit, settings) || seen.has(visit.canonicalUrl)) continue;
    seen.add(visit.canonicalUrl);
    if (unread.length < MAX_UNREAD) unread.push({ title: visit.title.trim() || hostOf(visit.canonicalUrl), url: visit.canonicalUrl });
  }
  return { entries, unread };
}

export type WrapUpBuild = ReturnType<typeof buildWrapUpInput> & {};

export function buildWrapUpInput(sources: TrailSources & { sameDay: SameDay[] }, settings: RecordingSettings) {
  const { entries } = collectTrail(sources, settings);
  if (!entries.length) return;
  const sameDayIds = new Map<string, string>();
  const sameDay = sources.sameDay.flatMap(({ expedition, root }) => {
    if (expedition.id === sources.expedition.id || !allowed(root, settings) || root.id !== expedition.rootVisitId) return [];
    const id = `e${sameDayIds.size + 1}`;
    sameDayIds.set(id, expedition.id);
    return [{ id, title: cap(expedition.title, 768), drivingQuestion: expedition.drivingQuestion ? cap(expedition.drivingQuestion, 768) : null }];
  }).slice(0, 10);
  for (const id of [...sameDayIds.keys()].slice(sameDay.length)) sameDayIds.delete(id);
  return { input: { expedition: { title: cap(sources.expedition.title, 768) }, trail: entries, sameDay }, sameDayIds };
}

export function buildFieldNotesInput(sources: TrailSources, settings: RecordingSettings) {
  const { entries, unread } = collectTrail(sources, settings);
  if (!entries.some((entry) => 'url' in entry)) return;
  const { expedition } = sources;
  const links = new Map(entries.flatMap((entry) => 'url' in entry ? [[entry.ref, { title: entry.title, url: entry.url }] as const] : []));
  return {
    input: {
      expedition: { title: cap(expedition.title, 768), drivingQuestion: expedition.drivingQuestion ? cap(expedition.drivingQuestion, 768) : null },
      trail: entries,
    },
    links,
    unread,
    question: expedition.drivingQuestion?.trim() || expedition.title,
  };
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const linkText = (text: string) => oneLine(text).replace(/[\\[\]]/g, '\\$&');
const link = ({ title, url }: Link) => `[${linkText(title)}](${url.replace(/[()\s]/g, encodeURIComponent)})`;

/** Renders the §4.6 Markdown. Citations come from the Pages we sent, never from model-written links. */
export function renderFieldNotes(draft: FieldNotesDraft, built: NonNullable<ReturnType<typeof buildFieldNotesInput>>): string {
  const ideas = draft.key_ideas.flatMap(({ idea, page }) => {
    const source = built.links.get(page.trim());
    return source && oneLine(idea) ? [`- ${oneLine(idea)} (${link(source)})`] : [];
  });
  const looseEnds = [
    ...built.unread.map((tab) => `- Opened but never read: ${link(tab)}`),
    ...draft.loose_ends.map(oneLine).filter(Boolean).map((end) => `- ${end}`),
  ];
  return [
    '## Question', '', oneLine(built.question), '',
    '## What you found', '', draft.found.trim(), '',
    '## Key ideas', '', ...ideas, '',
    '## How the trail went', '', draft.trail.trim(), '',
    '## Loose ends', '', ...(looseEnds.length ? looseEnds : ['- Nothing left open.']), '',
  ].join('\n');
}

export function hasCitedIdea(draft: FieldNotesDraft, built: NonNullable<ReturnType<typeof buildFieldNotesInput>>) {
  return draft.key_ideas.some(({ idea, page }) => built.links.has(page.trim()) && oneLine(idea));
}
