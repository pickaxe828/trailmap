/**
 * The browser-event seam for capture (docs/PLAN.md §4.1).
 *
 * The visit recorder never touches `chrome.*`. It receives these normalised
 * events from a `BrowserEventSource`: `chrome-events.ts` is the production one,
 * `testing.ts` has a fake for unit tests. Later tickets (page text, queries,
 * engagement, segmentation) can subscribe to the recorder instead of
 * registering their own navigation listeners.
 */

import type { PageContent, PageContentReply } from './page-messages';

/** `webNavigation` transition types, as Chrome spells them. */
export type NavTransitionType =
  | 'link'
  | 'typed'
  | 'auto_bookmark'
  | 'auto_subframe'
  | 'manual_subframe'
  | 'generated'
  | 'start_page'
  | 'form_submit'
  | 'reload'
  | 'keyword'
  | 'keyword_generated'
  | 'auto_toplevel';

export type NavTransitionQualifier = 'client_redirect' | 'server_redirect' | 'forward_back' | 'from_address_bar';

export type NavigationEvent = {
  tabId: number;
  frameId: number;
  documentId?: string;
  url: string;
  transitionType: NavTransitionType;
  transitionQualifiers: NavTransitionQualifier[];
};

export type CreatedNavigationTargetEvent = {
  /** The tab the link was opened from. */
  sourceTabId: number;
  /** The newly created tab. */
  tabId: number;
  url: string;
};

export type IdleState = 'active' | 'idle' | 'locked';

/** `windows.WINDOW_ID_NONE`: no Chrome window has focus. */
export const WINDOW_ID_NONE = -1;

/** What the browser looks like right now; used to seed active-time tracking. */
export type BrowserSnapshot = {
  /** The active tab of each window, keyed by window id. */
  activeTabByWindow: Record<number, number>;
  focusedWindowId: number;
  idleState: IdleState;
};

/**
 * Everything the recorder wants to hear about. Every handler returns a promise
 * that resolves once the recorder has finished (and persisted) its work, so a
 * test can `await` an event; the production adapter ignores the promise.
 */
export type PageContentEvent = { tabId: number; documentId?: string; url: string; content: PageContent };

export type BrowserEventHandlers = {
  /** `webNavigation.onCommitted` */
  onCommitted(event: NavigationEvent): Promise<void>;
  /** `webNavigation.onHistoryStateUpdated` (single-page-app navigation) */
  onHistoryStateUpdated(event: NavigationEvent): Promise<void>;
  /** `webNavigation.onCreatedNavigationTarget` */
  onCreatedNavigationTarget(event: CreatedNavigationTargetEvent): Promise<void>;
  /** `tabs.onActivated` */
  onTabActivated(event: { tabId: number; windowId: number }): Promise<void>;
  /** `windows.onFocusChanged`; `WINDOW_ID_NONE` when Chrome lost focus. */
  onWindowFocusChanged(windowId: number): Promise<void>;
  /** `idle.onStateChanged` */
  onIdleStateChanged(state: IdleState): Promise<void>;
  /** `visibilitychange` in the page, relayed by a content script. */
  onPageVisibilityChanged(event: { tabId: number; visible: boolean }): Promise<void>;
  /** Content from the current top-level document. */
  onPageContent(event: PageContentEvent): Promise<PageContentReply | undefined>;
  /** `tabs.onUpdated` with a title (and the URL the tab had at that moment). */
  onTabTitleChanged(event: { tabId: number; url: string; title: string }): Promise<void>;
  /** `tabs.onRemoved` */
  onTabRemoved(tabId: number): Promise<void>;
  /** `windows.onRemoved` */
  onWindowRemoved(windowId: number): Promise<void>;
  /** `runtime.onStartup`: the browser (re)started, so every tab id is new. */
  onBrowserStartup(): Promise<void>;
  /** A periodic nudge (an alarm) so active time is flushed even without events. */
  onTick(): Promise<void>;
};

export interface BrowserEventSource {
  /** Registers the handlers synchronously and returns an unsubscribe function. */
  subscribe(handlers: BrowserEventHandlers): () => void;
  /** Reads the current focus/active-tab/idle state. */
  snapshot(): Promise<BrowserSnapshot>;
}
