import type { Expedition, FieldNotesDraft, Highlight, Page, Query, Visit } from '@trailmap/shared';
import { googleSearchSurface } from '../capture/search';
import { cap } from '../enrichment/input';
import { eligibleMetadata as allowed, maySendToModel, recordingState, type RecordingSettings } from '../privacy/policy';
import { allowsSources, modelSources } from '../privacy/sources';
import { markdownLink as link, oneLine } from './markdown';

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
  summary: string | null; takeaways: string[]; highlights: string[]; contentKind?: 'ai_conversation';
};
export type TrailEntry = SearchEntry | PageEntry;
type Link = { title: string; url: string; aiGenerated?: true };

const hostOf = (url: string) => URL.parse(url)?.hostname ?? url;
const byTime = (a: Visit, b: Visit) => a.startedAt - b.startedAt ||
  Number(!!b.aiOpeningQuery) - Number(!!a.aiOpeningQuery) || a.id.localeCompare(b.id);

const sourceMap = ({ visits, sourceVisits }: TrailSources) => new Map([...sourceVisits, ...visits].map((visit) => [visit.id, visit]));

/**
 * The model-visible trail of an Expedition, in the order it happened, plus the
 * tabs that were opened but never read. Bounced Visits never reach the model;
 * they only become local loose ends.
 */
export function collectTrail({ visits, pages, highlights, queries, sourceVisits }: TrailSources, settings: RecordingSettings,
  includeMetadataOnly = false) {
  const ordered = [...visits].sort(byTime);
  const pageByUrl = new Map(pages.map((page) => [page.canonicalUrl, page]));
  const sourceById = new Map([...sourceVisits, ...visits].map((visit) => [visit.id, visit]));
  const contributors = new Set<Visit>();
  const dependencies: (Page['enrichmentSources'])[] = [];
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
    if (!visit.aiConversation && googleSearchSurface(visit.url)) continue;
    const page = pageByUrl.get(visit.canonicalUrl);
    const source = page?.sourceVisitId ? sourceById.get(page.sourceVisitId) : undefined;
    const hasText = maySendToModel(visit, page, settings, source);
    if (!hasText && (!includeMetadataOnly || !allowed(visit, settings) || visit.engagement === 'bounced')) continue;
    if (!picked.some((entry) => !entry.query && entry.visit.canonicalUrl === visit.canonicalUrl)) {
      picked.push({ visit, page: hasText ? page : undefined });
    }
  }

  // Keep the budget for Pages the user actually read, but retain trail order.
  const pagePicks = picked.filter(({ query }) => !query);
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
    if (!pick.query) refOfUrl.set(pick.visit.canonicalUrl, ref);
  }
  const byId = new Map(visits.map((candidate) => [candidate.id, candidate]));
  const cameFrom = (visit: Visit) => {
    // Nearest included ancestor, so a bounced hop doesn't break the story.
    for (let parent = visit.parentVisitId ? byId.get(visit.parentVisitId) : undefined, hops = 0; parent && hops < 100;
      parent = parent.parentVisitId ? byId.get(parent.parentVisitId) : undefined, hops++) {
      if (!allowed(parent, settings)) return null;
      const ref = refOfVisit.get(parent.id) ?? refOfUrl.get(parent.canonicalUrl);
      if (ref && ref !== refOfVisit.get(visit.id)) {
        contributors.add(parent);
        return ref;
      }
    }
    return null;
  };

  for (const pick of picked) {
    if (dropped.has(pick)) continue;
    const { visit, page, query } = pick;
    const ref = refOfVisit.get(visit.id)!;
    contributors.add(visit);
    if (query) {
      entries.push({ ref, q: cap(query.q, 768), cameFrom: cameFrom(visit) });
      continue;
    }
    const sameUrl = new Set(visits.filter((candidate) => candidate.canonicalUrl === visit.canonicalUrl &&
      candidate.engagement !== 'bounced' && allowed(candidate, settings)).map(({ id }) => id));
    const excerpts = highlights.filter((item) => sameUrl.has(item.visitId) && (!item.canonicalUrl || item.canonicalUrl === visit.canonicalUrl)).slice(0, 5);
    for (const item of excerpts) contributors.add(byId.get(item.visitId)!);
    const enrichmentIds = [page?.enrichmentVisitId, page?.enrichmentSourceVisitId].filter((id): id is string => !!id);
    const enrichSources = modelSources([], page?.enrichmentSources, {
      visitIds: enrichmentIds, canonicalUrls: page?.enrichmentSourceUrl ? [page.enrichmentSourceUrl] : [],
    });
    const enriched = page?.enrichedAt !== null && page?.summary && allowsSources(enrichSources, sourceById, settings);
    if (enriched) {
      dependencies.push(enrichSources, { visitIds: page.sourceVisitId ? [page.sourceVisitId] : [],
        canonicalUrls: page.sourceUrl ? [page.sourceUrl] : [] });
    }
    entries.push({
      ref, title: cap(visit.title || hostOf(visit.canonicalUrl), 768), url: visit.aiConversation ? visit.url : visit.canonicalUrl,
      ...(visit.aiConversation ? { contentKind: 'ai_conversation' as const } : {}),
      engagement: visit.engagement, cameFrom: cameFrom(visit),
      summary: enriched ? cap(page!.summary!, 1500) : null,
      takeaways: enriched ? page!.takeaways.slice(0, 5).map((takeaway) => cap(takeaway, 600)) : [],
      highlights: excerpts.map(({ text }) => cap(text, 800)),
    });
  }

  const unread: NonNullable<Expedition['unreadStops']> = [];
  const seen = new Set<string>(entries.flatMap((entry) => 'url' in entry ? [entry.url] : []));
  for (const visit of ordered) {
    if (visit.engagement !== 'bounced' || queryByVisit.has(visit.id) || !allowed(visit, settings) || seen.has(visit.canonicalUrl)) continue;
    seen.add(visit.canonicalUrl);
    if (unread.length < MAX_UNREAD) unread.push({ visitId: visit.id, title: visit.title.trim() || hostOf(visit.canonicalUrl), url: visit.canonicalUrl });
  }
  return { entries, unread, provenance: modelSources([...contributors], ...dependencies) };
}

export type WrapUpBuild = ReturnType<typeof buildWrapUpInput> & {};

export function buildWrapUpInput(sources: TrailSources & { sameDay: SameDay[] }, settings: RecordingSettings) {
  const { entries, provenance } = collectTrail(sources, settings, true);
  if (!entries.length) return;
  const byId = sourceMap(sources);
  const sameDayIds = new Map<string, string>();
  const sameDaySources: Expedition['wrapUpSource'][] = [];
  const sameDay = sources.sameDay.flatMap(({ expedition, root }) => {
    if (sameDayIds.size >= 10 || expedition.id === sources.expedition.id || !allowed(root, settings) || root.id !== expedition.rootVisitId ||
      !allowsSources(expedition.wrapUpSource, byId, settings)) return [];
    const id = `e${sameDayIds.size + 1}`;
    sameDayIds.set(id, expedition.id);
    sameDaySources.push(modelSources([root], expedition.wrapUpSource));
    return [{ id, title: cap(expedition.title, 768), drivingQuestion: expedition.drivingQuestion ? cap(expedition.drivingQuestion, 768) : null }];
  });
  const context = expeditionContext(sources, settings, provenance.visitIds);
  return { input: { expedition: { title: context.title }, trail: entries, sameDay }, sameDayIds,
    provenance: modelSources([], provenance, context.provenance, ...sameDaySources) };
}

function expeditionContext(sources: TrailSources, settings: RecordingSettings, trailVisitIds: string[]) {
  const byId = sourceMap(sources);
  const { expedition } = sources;
  const root = expedition.rootVisitId ? byId.get(expedition.rootVisitId) : undefined;
  if (!allowed(root, settings) || !trailVisitIds.includes(root.id) || !allowsSources(expedition.wrapUpSource, byId, settings)) {
    return { title: 'Browsing Expedition', drivingQuestion: null, provenance: undefined };
  }
  return { title: cap(expedition.title, 768), drivingQuestion: expedition.drivingQuestion ? cap(expedition.drivingQuestion, 768) : null,
    provenance: modelSources([root], expedition.wrapUpSource) };
}

export function buildFieldNotesInput(sources: TrailSources, settings: RecordingSettings) {
  const { entries, unread, provenance } = collectTrail(sources, settings);
  if (!entries.some((entry) => 'url' in entry)) return;
  const { title, drivingQuestion, provenance: context } = expeditionContext(sources, settings, provenance.visitIds);
  const links = new Map<string, Link>(entries.flatMap((entry) => 'url' in entry ? [[entry.ref, {
    title: entry.title, url: entry.url, ...(entry.contentKind === 'ai_conversation' ? { aiGenerated: true as const } : {}),
  }] as const] : []));
  return { input: { expedition: { title, drivingQuestion }, trail: entries }, links, unread,
    provenance: modelSources([], provenance, context), question: drivingQuestion?.trim() || title };
}

/** Renders the §4.6 Markdown. Citations come from the Pages we sent, never from model-written links. */
export function renderFieldNotes(draft: FieldNotesDraft, built: NonNullable<ReturnType<typeof buildFieldNotesInput>>): string {
  const ideas = draft.key_ideas.flatMap(({ idea, page }) => {
    const source = built.links.get(page.trim());
    return source && oneLine(idea) ? [`- ${oneLine(idea)} (${source.aiGenerated ? 'AI-generated; not a source' : link(source)})`] : [];
  });
  const looseEnds = draft.loose_ends.map(oneLine).filter(Boolean).map((end) => `- ${end}`);
  return [
    '## Question', '', oneLine(built.question), '',
    '## What you found', '',
    ...([...built.links.values()].some(({ aiGenerated }) => aiGenerated) ? ['Includes AI-generated material from Google AI Mode, not an independent source.', ''] : []),
    draft.found.trim(), '',
    '## Key ideas', '', ...ideas, '',
    '## How the trail went', '', draft.trail.trim(), '',
    '## Loose ends', '', ...(looseEnds.length ? looseEnds : ['- Nothing left open.']), '',
  ].join('\n');
}

export function hasCitedIdea(draft: FieldNotesDraft, built: NonNullable<ReturnType<typeof buildFieldNotesInput>>) {
  return draft.key_ideas.some(({ idea, page }) => built.links.has(page.trim()) && oneLine(idea));
}
