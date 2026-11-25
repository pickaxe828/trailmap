import type { Expedition, Highlight, Page, Visit } from '@trailmap/shared';
import { PAGE_TEXT_BYTE_LIMIT } from '../capture/page-messages';
import { maySendToModel, recordingState, type RecordingSettings } from '../privacy/policy';

type Sources = {
  visit: Visit;
  page: Page;
  highlights: Highlight[];
  sourceVisit?: Visit;
  expedition?: Expedition;
  root?: Visit;
  parent?: Visit;
};

export function cap(text: string, bytes: number): string {
  const buffer = new Uint8Array(bytes);
  const { written } = new TextEncoder().encodeInto(text, buffer);
  return new TextDecoder().decode(buffer.subarray(0, written));
}

export function buildEnrichmentInput({ visit, page, highlights, sourceVisit, expedition, root, parent }: Sources, settings: RecordingSettings) {
  // Context titles are navigation metadata, not Page excerpts. Do not include
  // even that metadata from a skipped/private Visit or one we can't identify.
  const allowedContext = (context: Visit | undefined) => context && !context.privacyBlocked &&
    recordingState(context.url, settings) === 'recording' && recordingState(context.canonicalUrl, settings) === 'recording';
  if (!maySendToModel(visit, page, settings, sourceVisit)) return;
  const question = expedition?.rootVisitId && root?.id === expedition.rootVisitId && allowedContext(root)
    ? expedition.drivingQuestion || expedition.title : null;
  return {
    title: cap(visit.title || new URL(page.canonicalUrl).hostname, 768),
    url: page.canonicalUrl,
    text: cap(page.text, PAGE_TEXT_BYTE_LIMIT),
    highlights: highlights.filter((item) => item.visitId === visit.id && (!item.canonicalUrl || item.canonicalUrl === page.canonicalUrl))
      .slice(0, 10).map(({ text }) => ({ text: cap(text, 800), important: true })),
    drivingQuestion: question ? cap(question, 768) : null,
    parentTitle: parent?.id === visit.parentVisitId && allowedContext(parent) && parent.title ? cap(parent.title, 768) : null,
  };
}
