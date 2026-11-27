import type { Expedition, Highlight, Page, Visit } from '@trailmap/shared';
import { PAGE_TEXT_BYTE_LIMIT } from '../capture/page-messages';
import { youtubeWatchId } from '../capture/youtube';
import { eligibleMetadata, maySendToModel, type RecordingSettings } from '../privacy/policy';

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
  if (!maySendToModel(visit, page, settings, sourceVisit)) return;
  const question = expedition?.rootVisitId && root?.id === expedition.rootVisitId && eligibleMetadata(root, settings)
    ? expedition.drivingQuestion || expedition.title : null;
  return {
    title: cap(visit.title || new URL(page.canonicalUrl).hostname, 768),
    url: visit.aiConversation ? visit.url : page.canonicalUrl,
    ...(visit.aiConversation ? { contentKind: 'ai_conversation' as const } : youtubeWatchId(visit.url) ? { contentKind: 'video' as const }
      : visit.pdf ? { contentKind: 'pdf' as const } : {}),
    text: cap(page.text, PAGE_TEXT_BYTE_LIMIT),
    highlights: highlights.filter((item) => item.visitId === visit.id && (!item.canonicalUrl || item.canonicalUrl === page.canonicalUrl))
      .slice(0, 10).map(({ text }) => ({ text: cap(text, 800), important: true })),
    drivingQuestion: question ? cap(question, 768) : null,
    parentTitle: parent?.id === visit.parentVisitId && eligibleMetadata(parent, settings) && parent.title ? cap(parent.title, 768) : null,
  };
}
