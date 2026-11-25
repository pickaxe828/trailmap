import type { Highlight } from '@trailmap/shared';

/** Messages a content script sends the background (intra-extension, so not in @trailmap/shared). */
export const PAGE_VISIBILITY_MESSAGE = 'trailmap.pageVisibility';

export type PageVisibilityMessage = { type: typeof PAGE_VISIBILITY_MESSAGE; visible: boolean };

export function isPageVisibilityMessage(value: unknown): value is PageVisibilityMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === PAGE_VISIBILITY_MESSAGE &&
    typeof (value as { visible?: unknown }).visible === 'boolean'
  );
}

export const PAGE_CONTENT_MESSAGE = 'trailmap.pageContent';
export const PAGE_TEXT_BYTE_LIMIT = 12_000;

type PageText = { text: string; textHash: string; sourceHash: string };

export type PageContent =
  | { kind: 'probe'; canonicalLink?: string; sourceHash: string }
  | ({ kind: 'text'; visitId: string } & PageText)
  | { kind: 'scroll'; depth: number }
  | { kind: 'highlight'; source: Highlight['source']; text: string; canonicalLink?: string };

export type PageContentMessage = PageContent & { type: typeof PAGE_CONTENT_MESSAGE; pageUrl: string };
export type PageContentReply = { visitId: string; extract: boolean };

const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function isPageContentMessage(value: unknown): value is PageContentMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.type !== PAGE_CONTENT_MESSAGE || typeof message.pageUrl !== 'string') return false;
  if (message.kind === 'scroll') {
    return typeof message.depth === 'number' && Number.isFinite(message.depth) && message.depth > 0 && message.depth <= 1;
  }
  const validCanonical = message.canonicalLink === undefined || typeof message.canonicalLink === 'string';
  if (message.kind === 'highlight') {
    return validCanonical && (message.source === 'selection' || message.source === 'copy')
      && typeof message.text === 'string' && message.text.trim().length > 0;
  }
  if (message.kind === 'probe') {
    return validCanonical && isHash(message.sourceHash);
  }
  return message.kind === 'text'
    && typeof message.visitId === 'string'
    && typeof message.text === 'string' && message.text.length > 0 && message.text.length <= PAGE_TEXT_BYTE_LIMIT
    && isHash(message.textHash) && isHash(message.sourceHash);
}
