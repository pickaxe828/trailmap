/** WXT substitutes this at build time, so Chrome never needs the Gecko adapters. */
export const isFirefox = import.meta.env.FIREFOX;

export function configurePanelAction() {
  if (isFirefox) {
    // sidebarAction.open requires a user gesture. Call it directly in the click handler.
    const { sidebarAction } = chrome as typeof chrome & { sidebarAction: { open(): Promise<void> } };
    chrome.action.onClicked.addListener(() => { void sidebarAction.open().catch(() => {}); });
  } else {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
}

export function openOrClosedShadowRoot(element: HTMLElement): ShadowRoot | null {
  if (isFirefox) return (element as HTMLElement & { openOrClosedShadowRoot?: ShadowRoot }).openOrClosedShadowRoot ?? null;
  return chrome.dom?.openOrClosedShadowRoot(element) ?? null;
}

export function isActiveDocument(details: { documentId?: string; documentLifecycle?: string }, gecko = isFirefox) {
  // Gecko has stable document IDs but no lifecycle property. The recorder also checks
  // the committed document ID and URL against the message (including after pushState).
  return details.documentLifecycle === 'active' ||
    (gecko && details.documentLifecycle === undefined && !!details.documentId);
}

export function nativeDisconnectReason(port: chrome.runtime.Port): string | undefined {
  const reason = chrome.runtime.lastError?.message;
  if (!isFirefox) return reason;
  const error = reason ?? (port as chrome.runtime.Port & { error?: Error }).error?.message;
  if (error && /No such native application|does not have permission to use native application/i.test(error)) {
    return 'Native messaging host not found or forbidden';
  }
  return error;
}

const ICON_BYTES = 16 * 1024;
const RASTER = /^image\/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon)$/;
const DATA_ICON = /^data:image\/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isCapturedIcon(value: unknown): value is string {
  return typeof value === 'string' && value.length <= Math.ceil(ICON_BYTES / 3) * 4 + 44 && DATA_ICON.test(value);
}

export function trailFavicon(page: string, size: number, captured?: string, gecko = isFirefox,
  getUrl: (path: string) => string = (path) => chrome.runtime.getURL(path)) {
  if (gecko) return isCapturedIcon(captured) ? captured : undefined;
  const url = new URL(getUrl('/_favicon/'));
  url.searchParams.set('pageUrl', page);
  url.searchParams.set('size', String(size));
  return url.href;
}

/** Run only from a screened content script. No remote icon loads from extension pages. */
export async function captureFavicon(page: URL): Promise<string | undefined> {
  if (!isFirefox || !/^https?:$/.test(page.protocol) || page.username || page.password) return;
  try {
    const response = await fetch(new URL('/favicon.ico', page.origin), {
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'force-cache', signal: AbortSignal.timeout(3000),
    });
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!response.ok || !RASTER.test(mime) || !response.body) {
      await response.body?.cancel();
      return;
    }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(ICON_BYTES);
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (size + part.value.length > bytes.length) {
          await reader.cancel();
          return;
        }
        bytes.set(part.value, size);
        size += part.value.length;
      }
    } finally {
      reader.releaseLock();
    }
    if (size) return `data:${mime};base64,${btoa(String.fromCharCode(...bytes.subarray(0, size)))}`;
  } catch {
    // Missing icons, redirects and blocked requests leave the card iconless.
  }
}
