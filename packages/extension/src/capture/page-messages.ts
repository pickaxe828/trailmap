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
