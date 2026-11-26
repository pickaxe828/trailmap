import type { Transition, Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { forgetCascade } from '../corrections/forget';
import { enqueuePageEnrichment } from '../enrichment/enqueue';
import { canonicalizeUrl } from './canonical';
import { scoreEngagement } from './engagement';
import { WINDOW_ID_NONE, type BrowserEventHandlers, type BrowserEventSource, type NavigationEvent, type PageContentEvent } from './events';
import type { PageContentReply } from './page-messages';
import { newPage } from './pages';
import { parseSearchQuery } from './search';
import { emptyRecorderState, type RecorderState, type RecorderStateStore } from './state-store';

export type VisitChange =
  | { type: 'created'; visit: Visit }
  | { type: 'updated'; visit: Visit; titleChanged?: true };

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
  db: TrailmapDb;
  source: BrowserEventSource;
  store: RecorderStateStore;
  /** The clock; fake it in tests. */
  now: () => number;
  newId: () => string;
  canonicalize?: typeof canonicalizeUrl;
  /** URL policy; production waits for persisted settings before using it. */
  shouldRecord?: (url: string) => boolean;
  policyReady?: Promise<void>;
  /** Wait for the active top-level content script to screen the document. */
  screenDocuments?: boolean;
  onPasswordStatusChanged?: (tabId: number) => void;
};

type PendingVisit = {
  event: Pick<NavigationEvent, 'tabId' | 'url' | 'documentId'>;
  transition: Transition;
  parentVisitId: string | null;
  startedAt: number;
  activeMs: number;
  lastActiveAt?: number;
  title: string;
};

const sameUrl = (left: string, right: string) => canonicalizeUrl(left) === canonicalizeUrl(right);

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
  // Unscreened URLs (which can be private) never go into session storage or IndexedDB.
  private pending = new Map<number, PendingVisit>();
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<(change: VisitChange) => void>();
  private readonly canonicalize: typeof canonicalizeUrl;

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

  isPasswordProtected(tabId: number): boolean {
    return this.state.passwordTabs?.includes(tabId) ?? false;
  }

  /** Apply a settings edit in order with navigations and content messages. */
  changeRecordingPolicy(update: () => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      await update();
      for (const [tabId, visit] of this.current) {
        if (!this.isRecordable(visit.url) || !this.isRecordable(visit.canonicalUrl)) this.endTrail(tabId);
      }
      for (const [tabId, pending] of this.pending) {
        if (!this.isRecordable(pending.event.url)) this.endTrail(tabId);
      }
      this.state.pendingNewTabParent = {};
    });
  }

  /**
   * Runs a deletion in order with captures, then stops tracking the removed
   * Visits so a page that is still open can't write them (or their text) back.
   */
  forgetVisits(remove: () => Promise<readonly string[]>): Promise<readonly string[]> {
    return this.enqueue(async () => {
      const removed = new Set(await remove());
      for (const [tabId, visit] of this.current) {
        if (removed.has(visit.id)) this.endTrail(tabId);
      }
      for (const [tabId, parent] of Object.entries(this.state.pendingNewTabParent)) {
        if (parent && removed.has(parent)) this.state.pendingNewTabParent[Number(tabId)] = null;
      }
      return [...removed];
    });
  }

  /** Checkpoint reading time before evaluating Expedition deadlines. */
  flushActiveTime(): Promise<void> {
    return this.enqueue(async () => {});
  }

  subscribe(listener: (change: VisitChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Loads persisted state (a restarted service worker) or, with none, starts from what the browser looks like now. */
  private async restore() {
    await this.options.policyReady;
    const saved = await this.options.store.load();
    if (!saved) return this.reset();
    this.state = saved;
    this.current.clear();
    for (const [tabId, visitId] of Object.entries(saved.currentVisitByTab)) {
      const visit = await this.options.db.visits.get(visitId);
      if (visit && !visit.privacyBlocked && this.isRecordable(visit.url) && this.isRecordable(visit.canonicalUrl)) {
        this.current.set(Number(tabId), visit);
      } else {
        this.endTrail(Number(tabId));
      }
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
    this.pending.clear();
  }

  /**
   * Runs `work` after everything queued before it, and persists state afterwards.
   * First it settles active time up to now: the inputs haven't changed since the
   * last event (a change would have woken us), so the whole gap belongs to
   * whichever tab was accruing.
   */
  private enqueue<T>(work: () => Promise<T>, { settle = true } = {}): Promise<T> {
    const run = this.queue.then(async () => {
      await this.ready;
      if (settle) await this.settleActiveTime();
      const result = await work();
      await this.options.store.save(this.state);
      return result;
    });
    this.queue = run.then(() => undefined, () => undefined);
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
    if (tabId === undefined) return;
    const visit = this.current.get(tabId);
    if (visit) await this.updateEngagement(visit, { activeMs: visit.activeMs + now - last, lastActiveAt: now });
    const pending = this.pending.get(tabId);
    if (pending) {
      pending.activeMs += now - last;
      pending.lastActiveAt = now;
    }
  }

  private async updateEngagement(visit: Visit, changes: Partial<Pick<Visit, 'activeMs' | 'lastActiveAt' | 'scrollDepth'>>, interacted = false) {
    const engagement = scoreEngagement(changes.activeMs ?? visit.activeMs, changes.scrollDepth ?? visit.scrollDepth,
      interacted || visit.engagement === 'read');
    const { db, now } = this.options;
    if (engagement !== visit.engagement) {
      await db.transaction('rw', db.visits, db.pages, db.jobs, async () => {
        await db.visits.update(visit.id, { ...changes, engagement });
        await enqueuePageEnrichment(db, { ...visit, engagement }, now());
      });
    } else {
      await db.visits.update(visit.id, { ...changes, engagement });
    }
    Object.assign(visit, changes, { engagement });
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
    this.pending.delete(tabId);
    this.current.delete(tabId);
    delete this.state.currentVisitByTab[tabId];
    delete this.state.documentIdsByTab?.[tabId];
  }

  private setPasswordStatus(tabId: number, blocked: boolean, documentId?: string) {
    if (blocked && documentId) (this.state.passwordDocumentIdsByTab ??= {})[tabId] = documentId;
    else delete this.state.passwordDocumentIdsByTab?.[tabId];
    if (this.isPasswordProtected(tabId) === blocked) return;
    const tabs = this.state.passwordTabs ??= [];
    if (blocked) tabs.push(tabId);
    else this.state.passwordTabs = tabs.filter((id) => id !== tabId);
    this.options.onPasswordStatusChanged?.(tabId);
  }

  private async beginVisit(event: NavigationEvent, transition: Transition, parentVisitId: string | null) {
    this.endTrail(event.tabId);
    if (event.documentId && this.state.passwordDocumentIdsByTab?.[event.tabId] === event.documentId) return;
    this.setPasswordStatus(event.tabId, false);
    if (!this.isRecordable(event.url)) return;
    const pending = { event, transition, parentVisitId, startedAt: this.options.now(), activeMs: 0, title: '' };
    if (this.options.screenDocuments) this.pending.set(event.tabId, pending);
    else await this.createVisit(pending);
  }

  private async createVisit({ event, transition, parentVisitId, startedAt, activeMs, lastActiveAt, title }: PendingVisit) {
    const search = parseSearchQuery(event.url);
    const visit: Visit = {
      id: this.options.newId(),
      captureDocumentId: event.documentId,
      url: canonicalizeUrl(event.url),
      canonicalUrl: this.canonicalize(event.url),
      title,
      tabId: event.tabId,
      parentVisitId,
      transition: search && !parentVisitId && transition !== 'new-tab' ? 'search' : transition,
      startedAt,
      activeMs,
      lastActiveAt,
      scrollDepth: 0,
      engagement: scoreEngagement(activeMs, 0),
      expeditionId: null,
      segmentationPending: 1,
    };
    const { db } = this.options;
    await db.transaction('rw', db.visits, db.queries, db.pages, db.jobs, async () => {
      if (visit.parentVisitId && !await db.visits.get(visit.parentVisitId)) visit.parentVisitId = null;
      await db.visits.put(visit);
      await enqueuePageEnrichment(db, visit, startedAt + activeMs);
      if (search) {
        await db.queries.put({
          ...search,
          id: this.options.newId(),
          visitId: visit.id,
          at: visit.startedAt,
          expeditionId: null,
        });
      }
    });
    this.current.set(event.tabId, visit);
    this.state.currentVisitByTab[event.tabId] = visit.id;
    if (event.documentId) {
      (this.state.documentIdsByTab ??= {})[event.tabId] = event.documentId;
    } else {
      delete this.state.documentIdsByTab?.[event.tabId];
    }
    this.emit({ type: 'created', visit: { ...visit } });
    return visit;
  }

  private async capturePageContent({ tabId, documentId, url, content }: PageContentEvent): Promise<PageContentReply | undefined> {
    const current = this.current.get(tabId);
    const visit = current && this.state.documentIdsByTab?.[tabId] === documentId && sameUrl(current.url, url) ? current : undefined;
    const { db } = this.options;
    if (content.kind === 'screen') {
      const pending = this.pending.get(tabId);
      const matches = pending && pending.event.documentId === documentId && sameUrl(pending.event.url, url);
      if (content.hasPassword) {
        const previouslyScreened = documentId ? await db.visits.where('captureDocumentId').equals(documentId).primaryKeys() : [];
        if (matches || visit || previouslyScreened.length) {
          // Earlier same-document screens are invalid too, including before a pushState.
          if (matches || visit || documentId === this.state.documentIdsByTab?.[tabId]) {
            this.endTrail(tabId);
            this.setPasswordStatus(tabId, true, documentId);
          }
          const visitIds = [...new Set([...previouslyScreened, ...(visit ? [visit.id] : [])])];
          if (visitIds.length) await forgetCascade(db, {
            kind: 'forget-page', visitIds, now: this.options.now, newId: this.options.newId, quiet: true,
          });
        }
        return;
      }
      if (!this.isRecordable(url)) return;
      if (matches) {
        const admitted = await this.createVisit(pending);
        this.pending.delete(tabId);
        return { visitId: admitted.id, extract: false };
      }
      return visit && { visitId: visit.id, extract: false };
    }
    if (!visit || !this.isRecordable(url) || !this.isRecordable(visit.canonicalUrl)) return;
    if (content.kind === 'scroll') {
      if (content.depth <= visit.scrollDepth) return;
      await this.updateEngagement(visit, { scrollDepth: content.depth });
      return;
    }
    if (content.kind === 'selection') {
      if (visit.engagement !== 'read') await this.updateEngagement(visit, {}, true);
      return;
    }
    if (content.kind === 'text') {
      if (content.visitId !== visit.id) return;
      await db.transaction('rw', db.pages, db.jobs, async () => {
        const previous = await db.pages.get(visit.canonicalUrl);
        const source = { sourceHash: content.sourceHash, sourceUrl: this.canonicalize(visit.url), sourceVisitId: visit.id };
        const page = previous?.textHash === content.textHash
          ? { ...previous, ...source }
          : {
              ...newPage(visit.canonicalUrl, content.text, content.textHash), ...source,
              textRevision: (previous?.textRevision ?? 0) + 1,
            };
        await db.pages.put(page);
        await enqueuePageEnrichment(db, visit, this.options.now(), page);
      });
      return;
    }

    const candidate = content.canonicalLink && this.canonicalize(visit.url, content.canonicalLink);
    const canonicalUrl = candidate && this.isRecordable(candidate) ? candidate : visit.canonicalUrl;
    const changed = canonicalUrl !== visit.canonicalUrl;
    const read = content.kind === 'highlight' && visit.engagement !== 'read';
    const page = await db.transaction('rw', db.visits, db.pages, db.highlights, db.jobs, async () => {
      const page = await db.pages.get(canonicalUrl);
      let needsPage = content.kind === 'highlight';
      if (changed) {
        await db.visits.update(visit.id, { canonicalUrl });
        const relinked = await db.highlights.where('visitId').equals(visit.id).modify({ canonicalUrl });
        needsPage ||= relinked > 0;
      }
      if (needsPage && !page) await db.pages.add(newPage(canonicalUrl));
      if (read) await db.visits.update(visit.id, { engagement: 'read' });
      if (content.kind === 'highlight') {
        await db.highlights.add({
          id: this.options.newId(),
          visitId: visit.id,
          canonicalUrl,
          text: content.text,
          at: this.options.now(),
          source: content.source,
        });
      }
      if (changed || read) {
        await enqueuePageEnrichment(db, { ...visit, canonicalUrl, engagement: read ? 'read' : visit.engagement }, this.options.now(), page);
      }
      return page;
    });
    if (changed || read) {
      visit.canonicalUrl = canonicalUrl;
      if (read) visit.engagement = 'read';
      this.emit({ type: 'updated', visit: { ...visit } });
    }
    if (content.kind === 'probe') {
      return { visitId: visit.id, extract: !page?.sourceUrl || page.sourceHash !== content.sourceHash || !this.isRecordable(page.sourceUrl) };
    }
  }

  private readonly handlers: BrowserEventHandlers = {
    onCommitted: (event) =>
      this.enqueue(async () => {
        if (event.frameId !== 0) return;
        const pending = this.state.pendingNewTabParent[event.tabId];
        delete this.state.pendingNewTabParent[event.tabId];
        const transition = pending !== undefined ? 'new-tab' : toVisitTransition(event);
        await this.beginVisit(event, transition, pending !== undefined ? pending : this.parentFor(event.tabId, transition));
      }),
    onHistoryStateUpdated: (event) =>
      this.enqueue(async () => {
        if (event.frameId !== 0) return;
        if (this.current.get(event.tabId)?.url === canonicalizeUrl(event.url) || this.pending.get(event.tabId)?.event.url === event.url) return;
        const transition = event.transitionQualifiers.includes('forward_back') ? 'back' : 'link';
        await this.beginVisit(event, transition, this.parentFor(event.tabId, transition));
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
    onPageContent: (event) => this.enqueue(() => this.capturePageContent(event), { settle: event.content.kind === 'screen' }),
    onTabTitleChanged: ({ tabId, url, title }) =>
      this.enqueue(async () => {
        const pending = this.pending.get(tabId);
        if (pending && sameUrl(pending.event.url, url)) pending.title = title;
        const visit = this.current.get(tabId);
        if (!visit || !sameUrl(visit.url, url) || visit.title === title) return;
        const firstTitle = !visit.title.trim() && !!title.trim();
        visit.title = title;
        await this.options.db.visits.where('id').equals(visit.id).modify((stored) => {
          stored.title = title;
          if (firstTitle && stored.expeditionId && stored.expeditionEmbedding === undefined) {
            stored.segmentationPending = 1;
          }
        });
        this.emit({ type: 'updated', visit: { ...visit }, titleChanged: true });
      }),
    onTabRemoved: (tabId) =>
      this.enqueue(async () => {
        this.endTrail(tabId);
        this.setPasswordStatus(tabId, false);
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
