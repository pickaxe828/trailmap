import type { Transition, Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { canonicalizeUrl } from './canonical';
import { WINDOW_ID_NONE, type BrowserEventHandlers, type BrowserEventSource, type NavigationEvent } from './events';
import { emptyRecorderState, type RecorderState, type RecorderStateStore } from './state-store';

export type VisitChange = { type: 'created'; visit: Visit } | { type: 'updated'; visit: Visit };

/** Maps `webNavigation`'s transition type and qualifiers to a Visit transition. */
export function toVisitTransition(event: Pick<NavigationEvent, 'transitionType' | 'transitionQualifiers'>): Transition {
  if (event.transitionQualifiers.includes('forward_back')) return 'back';
  switch (event.transitionType) {
    case 'typed':
    case 'generated':
    case 'keyword':
    case 'keyword_generated':
      return 'typed';
    case 'form_submit':
      return 'form';
    case 'reload':
      return 'reload';
    case 'auto_bookmark':
      return 'bookmark';
    case 'start_page':
    case 'auto_toplevel':
      return 'auto';
    default:
      return 'link';
  }
}

export type VisitRecorderOptions = {
  db: Pick<TrailmapDb, 'visits'>;
  source: BrowserEventSource;
  store: RecorderStateStore;
  /** The clock; fake it in tests. */
  now: () => number;
  newId: () => string;
  canonicalize?: (url: string) => string;
  /**
   * Decides whether a URL becomes a Visit. The default accepts http(s) pages
   * only; the privacy filters (ticket 08) pass a stricter one.
   */
  shouldRecord?: (url: string) => boolean;
};

/**
 * Turns browser events into Visits (docs/PLAN.md §4.1).
 *
 * - Events are handled one at a time, in order.
 * - All state that survives a service-worker restart lives in `RecorderState`
 *   and is saved after every event.
 */
export class VisitRecorder {
  /** Resolves once state has been restored; handlers wait for it. */
  ready: Promise<void> = Promise.resolve();

  private state: RecorderState = emptyRecorderState();
  private current = new Map<number, Visit>();
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<(change: VisitChange) => void>();
  private readonly canonicalize: (url: string) => string;

  constructor(private readonly options: VisitRecorderOptions) {
    this.canonicalize = options.canonicalize ?? canonicalizeUrl;
  }

  /** Subscribes to the event source. Call synchronously from the service worker's top level. */
  start(): () => void {
    this.ready = this.restore();
    return this.options.source.subscribe(this.handlers);
  }

  /** The Visit currently shown in a tab, if any. */
  getCurrentVisit(tabId: number): Visit | undefined {
    const visit = this.current.get(tabId);
    return visit && { ...visit };
  }

  subscribe(listener: (change: VisitChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Loads persisted state (a restarted service worker) or, with none, starts from what the browser looks like now. */
  private async restore() {
    const saved = await this.options.store.load();
    if (!saved) return this.reset();
    this.state = saved;
    this.current.clear();
    for (const [tabId, visitId] of Object.entries(saved.currentVisitByTab)) {
      const visit = await this.options.db.visits.get(visitId);
      if (visit) this.current.set(Number(tabId), visit);
      else delete this.state.currentVisitByTab[Number(tabId)];
    }
  }

  /** Forgets every tab (their ids are only valid for one browser session) and re-reads focus, active tabs and idle state. */
  private async reset() {
    const snapshot = await this.options.source.snapshot();
    this.state = {
      ...emptyRecorderState(),
      activeTabByWindow: snapshot.activeTabByWindow,
      focusedWindowId: snapshot.focusedWindowId,
      idleState: snapshot.idleState,
      lastSettledAt: this.options.now(),
    };
    this.current.clear();
  }

  /**
   * Runs `work` after everything queued before it, and persists state afterwards.
   * First it settles active time up to now: the inputs haven't changed since the
   * last event (a change would have woken us), so the whole gap belongs to
   * whichever tab was accruing.
   */
  private enqueue(work: () => Promise<void>, { settle = true } = {}): Promise<void> {
    const run = this.queue.then(async () => {
      await this.ready;
      if (settle) await this.settleActiveTime();
      await work();
      await this.options.store.save(this.state);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The one tab that is accruing active time: active in the focused window, user present, page visible. */
  private accruingTabId(): number | undefined {
    const { focusedWindowId, idleState, activeTabByWindow, hiddenTabs } = this.state;
    if (focusedWindowId === WINDOW_ID_NONE || idleState !== 'active') return undefined;
    const tabId = activeTabByWindow[focusedWindowId];
    return tabId === undefined || hiddenTabs.includes(tabId) ? undefined : tabId;
  }

  private async settleActiveTime() {
    const now = this.options.now();
    const last = this.state.lastSettledAt;
    this.state.lastSettledAt = now;
    if (last === null || now <= last) return;
    const tabId = this.accruingTabId();
    const visit = tabId === undefined ? undefined : this.current.get(tabId);
    if (!visit) return;
    visit.activeMs += now - last;
    await this.options.db.visits.update(visit.id, { activeMs: visit.activeMs });
    this.emit({ type: 'updated', visit: { ...visit } });
  }

  private emit(change: VisitChange) {
    for (const listener of this.listeners) listener(change);
  }

  /**
   * Link, form and back/forward navigations hang off the tab's previous Visit.
   * A reload hangs off the reloaded page's own parent (a sibling), so reloading
   * doesn't deepen the trail. Typed, bookmark and start-page navigations start
   * a new trail.
   */
  private parentFor(tabId: number, transition: Transition): string | null {
    const previous = this.current.get(tabId);
    switch (transition) {
      case 'link':
      case 'form':
      case 'back':
      case 'new-tab':
      case 'search':
        return previous?.id ?? null;
      case 'reload':
        return previous?.parentVisitId ?? null;
      default:
        return null;
    }
  }

  private isRecordable(url: string): boolean {
    return /^https?:/i.test(url) && (this.options.shouldRecord?.(url) ?? true);
  }

  /** The tab no longer shows a recorded page, so the next navigation has no parent. */
  private endTrail(tabId: number) {
    this.current.delete(tabId);
    delete this.state.currentVisitByTab[tabId];
  }

  private async createVisit(event: Pick<NavigationEvent, 'tabId' | 'url'>, transition: Transition, parentVisitId: string | null) {
    const visit: Visit = {
      id: this.options.newId(),
      url: event.url,
      canonicalUrl: this.canonicalize(event.url),
      title: '',
      tabId: event.tabId,
      parentVisitId,
      transition,
      startedAt: this.options.now(),
      activeMs: 0,
      scrollDepth: 0,
      engagement: 'bounced',
      expeditionId: null,
    };
    await this.options.db.visits.put(visit);
    this.current.set(event.tabId, visit);
    this.state.currentVisitByTab[event.tabId] = visit.id;
    this.emit({ type: 'created', visit: { ...visit } });
  }

  private readonly handlers: BrowserEventHandlers = {
    onCommitted: (event) =>
      this.enqueue(async () => {
        if (event.frameId !== 0) return;
        const pending = this.state.pendingNewTabParent[event.tabId];
        delete this.state.pendingNewTabParent[event.tabId];
        if (!this.isRecordable(event.url)) {
          this.endTrail(event.tabId);
          return;
        }
        if (pending !== undefined) {
          await this.createVisit(event, 'new-tab', pending);
          return;
        }
        const transition = toVisitTransition(event);
        await this.createVisit(event, transition, this.parentFor(event.tabId, transition));
      }),
    onHistoryStateUpdated: (event) =>
      this.enqueue(async () => {
        if (event.frameId !== 0 || !this.isRecordable(event.url)) return;
        if (this.current.get(event.tabId)?.url === event.url) return;
        const transition = event.transitionQualifiers.includes('forward_back') ? 'back' : 'link';
        await this.createVisit(event, transition, this.parentFor(event.tabId, transition));
      }),
    onCreatedNavigationTarget: (event) =>
      this.enqueue(async () => {
        this.state.pendingNewTabParent[event.tabId] = this.current.get(event.sourceTabId)?.id ?? null;
      }),
    onTabActivated: ({ tabId, windowId }) =>
      this.enqueue(async () => {
        this.state.activeTabByWindow[windowId] = tabId;
      }),
    onWindowFocusChanged: (windowId) =>
      this.enqueue(async () => {
        this.state.focusedWindowId = windowId;
      }),
    onIdleStateChanged: (idleState) =>
      this.enqueue(async () => {
        this.state.idleState = idleState;
      }),
    onPageVisibilityChanged: ({ tabId, visible }) =>
      this.enqueue(async () => {
        const hidden = this.state.hiddenTabs.filter((id) => id !== tabId);
        if (!visible) hidden.push(tabId);
        this.state.hiddenTabs = hidden;
      }),
    onTabTitleChanged: ({ tabId, url, title }) =>
      this.enqueue(async () => {
        const visit = this.current.get(tabId);
        if (!visit || visit.url !== url || visit.title === title) return;
        visit.title = title;
        await this.options.db.visits.update(visit.id, { title });
        this.emit({ type: 'updated', visit: { ...visit } });
      }),
    onTabRemoved: (tabId) =>
      this.enqueue(async () => {
        this.endTrail(tabId);
        delete this.state.pendingNewTabParent[tabId];
        this.state.hiddenTabs = this.state.hiddenTabs.filter((id) => id !== tabId);
        for (const [windowId, active] of Object.entries(this.state.activeTabByWindow)) {
          if (active === tabId) delete this.state.activeTabByWindow[Number(windowId)];
        }
      }),
    onWindowRemoved: (windowId) =>
      this.enqueue(async () => {
        delete this.state.activeTabByWindow[windowId];
        if (this.state.focusedWindowId === windowId) this.state.focusedWindowId = WINDOW_ID_NONE;
      }),
    // No settling: time between the last event of the previous session and now is not browsing time.
    onBrowserStartup: () => this.enqueue(() => this.reset(), { settle: false }),
    onTick: () => this.enqueue(async () => {}),
  };
}
