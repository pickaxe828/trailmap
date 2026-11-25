import type { Transition, Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { canonicalizeUrl } from './canonical';
import type { BrowserEventHandlers, BrowserEventSource, NavigationEvent } from './events';
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
    return this.current.get(tabId);
  }

  subscribe(listener: (change: VisitChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async restore() {
    this.state = (await this.options.store.load()) ?? emptyRecorderState();
  }

  /** Runs `work` after everything queued before it, and persists state afterwards. */
  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      await this.ready;
      await work();
      await this.options.store.save(this.state);
    });
    this.queue = run.catch(() => undefined);
    return run;
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
    this.emit({ type: 'created', visit });
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
    onTabActivated: async () => {},
    onWindowFocusChanged: async () => {},
    onIdleStateChanged: async () => {},
    onPageVisibilityChanged: async () => {},
    onTabTitleChanged: async () => {},
    onTabRemoved: async () => {},
    onWindowRemoved: async () => {},
    onBrowserStartup: async () => {},
    onTick: async () => {},
  };
}
