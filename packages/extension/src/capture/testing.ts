/**
 * Test doubles for capture: a fake browser (no `chrome` globals) and a fake clock.
 * Used by the unit tests; not imported by the extension itself.
 */
import type {
  BrowserEventHandlers,
  BrowserEventSource,
  BrowserSnapshot,
  IdleState,
  NavTransitionQualifier,
  NavTransitionType,
} from './events';
import type { PageContent } from './page-messages';
import { WINDOW_ID_NONE } from './events';

export class FakeClock {
  constructor(public time = 1_700_000_000_000) {}
  now = () => this.time;
  advance(ms: number) {
    this.time += ms;
  }
}

type Nav = { transitionType?: NavTransitionType; qualifiers?: NavTransitionQualifier[]; frameId?: number; documentId?: string };

/** A scriptable stand-in for the browser: tests call these to "make things happen". */
export class FakeBrowser implements BrowserEventSource {
  private handlers: BrowserEventHandlers | null = null;
  snapshotValue: BrowserSnapshot = { activeTabByWindow: {}, focusedWindowId: WINDOW_ID_NONE, idleState: 'active' };

  subscribe(handlers: BrowserEventHandlers) {
    this.handlers = handlers;
    return () => {
      this.handlers = null;
    };
  }
  snapshot = async () => structuredClone(this.snapshotValue);

  private get h(): BrowserEventHandlers {
    if (!this.handlers) throw new Error('recorder is not subscribed');
    return this.handlers;
  }

  /** A top-frame navigation commits in a tab. */
  commit(tabId: number, url: string, nav: Nav = {}) {
    return this.h.onCommitted({
      tabId,
      url,
      frameId: nav.frameId ?? 0,
      documentId: nav.documentId,
      transitionType: nav.transitionType ?? 'link',
      transitionQualifiers: nav.qualifiers ?? [],
    });
  }
  /** `history.pushState` in a single-page app. */
  pushState(tabId: number, url: string, nav: Nav = {}) {
    return this.h.onHistoryStateUpdated({
      tabId,
      url,
      frameId: nav.frameId ?? 0,
      documentId: nav.documentId,
      transitionType: nav.transitionType ?? 'link',
      transitionQualifiers: nav.qualifiers ?? [],
    });
  }
  /** A link was opened in a new tab (`target=_blank`, ctrl-click, `window.open`). */
  openInNewTab(sourceTabId: number, tabId: number, url: string) {
    return this.h.onCreatedNavigationTarget({ sourceTabId, tabId, url });
  }
  activateTab(tabId: number, windowId = 1) {
    return this.h.onTabActivated({ tabId, windowId });
  }
  focusWindow(windowId: number) {
    return this.h.onWindowFocusChanged(windowId);
  }
  blurBrowser() {
    return this.h.onWindowFocusChanged(WINDOW_ID_NONE);
  }
  setIdle(state: IdleState) {
    return this.h.onIdleStateChanged(state);
  }
  setPageVisible(tabId: number, visible: boolean) {
    return this.h.onPageVisibilityChanged({ tabId, visible });
  }
  reportPageContent(tabId: number, url: string, content: PageContent, documentId?: string) {
    return this.h.onPageContent({ tabId, url, content, documentId });
  }
  setTitle(tabId: number, url: string, title: string) {
    return this.h.onTabTitleChanged({ tabId, url, title });
  }
  closeTab(tabId: number) {
    return this.h.onTabRemoved(tabId);
  }
  closeWindow(windowId: number) {
    return this.h.onWindowRemoved(windowId);
  }
  startBrowser() {
    return this.h.onBrowserStartup();
  }
  tick() {
    return this.h.onTick();
  }
}
