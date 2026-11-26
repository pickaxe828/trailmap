/**
 * The production `BrowserEventSource`: the only capture file that touches `chrome.*`.
 * Everything is registered synchronously in `subscribe`, which an MV3 service
 * worker requires (listeners added after the first tick miss the waking event).
 */
import type {
  BrowserEventHandlers,
  BrowserEventSource,
  BrowserSnapshot,
  IdleState,
  NavigationEvent,
  NavTransitionQualifier,
  NavTransitionType,
} from './events';
import { WINDOW_ID_NONE } from './events';
import { isPageContentMessage, isPageVisibilityMessage, OPEN_AI_CITATION } from './page-messages';
import type { VisitRecorder } from './recorder';
import type { RecorderState, RecorderStateStore } from './state-store';

const STORAGE_KEY = 'trailmap.recorderState';

/** Session storage shares the browser lifetime of the tab IDs in RecorderState. */
export class ChromeSessionStateStore implements RecorderStateStore {
  async load() {
    const stored = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY] as RecorderState | undefined;
    return stored?.version === 1 ? stored : null;
  }
  async save(state: RecorderState) {
    await chrome.storage.session.set({ [STORAGE_KEY]: state });
  }
}

export const TICK_ALARM = 'trailmap.capture-tick';
/** MV3 alarms can fire at most every 30 seconds. */
const TICK_PERIOD_MINUTES = 0.5;
/** Idle detection threshold, in seconds (also Chrome's default). */
export const IDLE_SECONDS = 60;

type CommittedDetails = {
  tabId: number;
  frameId: number;
  url: string;
  transitionType: string;
  transitionQualifiers: string[];
  documentLifecycle?: string;
  documentId?: string;
};

function toNavigationEvent(d: CommittedDetails): NavigationEvent {
  return {
    tabId: d.tabId,
    frameId: d.frameId,
    documentId: d.documentId,
    url: d.url,
    transitionType: d.transitionType as NavTransitionType,
    transitionQualifiers: d.transitionQualifiers as NavTransitionQualifier[],
  };
}

async function passwordFrame(tabId: number, documentId: string, h: BrowserEventHandlers) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const byDocument = new Map(frames?.filter((frame) => frame.documentLifecycle === 'active').map((frame) => [frame.documentId, frame]));
  let frame = byDocument.get(documentId);
  while (frame?.parentDocumentId) frame = byDocument.get(frame.parentDocumentId);
  if (frame?.frameId === 0) await h.onPageContent({
    tabId, documentId: frame.documentId, url: frame.url, content: { kind: 'screen', hasPassword: true },
  });
}

/** Detail links open normal web tabs, with the same capture rules as other links. */
export function startAiCitationLinks(recorder: VisitRecorder) {
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== 'object') return;
    const { type, visitId, url, background } = message as Record<string, unknown>;
    if (type !== OPEN_AI_CITATION || typeof visitId !== 'string' || typeof url !== 'string' || sender.frameId !== 0 ||
        sender.url?.split(/[?#]/, 1)[0] !== chrome.runtime.getURL('/expedition.html')) return;
    const destination = URL.parse(url);
    if (!destination || !/^https?:$/.test(destination.protocol) || destination.username || destination.password) return;
    void (async () => {
      const tab = await chrome.tabs.create({ active: background !== true });
      if (tab.id === undefined) return;
      try {
        if (await recorder.prepareCitationVisit(tab.id, visitId, url)) {
          await chrome.tabs.update(tab.id, { url });
        } else {
          await chrome.tabs.remove(tab.id);
        }
      } catch {
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
    })().then(() => respond(), () => respond());
    return true;
  });
}

export class ChromeEventSource implements BrowserEventSource {
  subscribe(h: BrowserEventHandlers): () => void {
    const onCommitted = (d: CommittedDetails) => {
      // Pre-rendered pages commit without the user going there.
      if (d.documentLifecycle === 'prerender') return;
      void h.onCommitted(toNavigationEvent(d));
    };
    const onHistoryStateUpdated = (d: CommittedDetails) => void h.onHistoryStateUpdated(toNavigationEvent(d));
    const onCreatedNavigationTarget = (d: { sourceTabId: number; tabId: number; url: string }) =>
      void h.onCreatedNavigationTarget({ sourceTabId: d.sourceTabId, tabId: d.tabId, url: d.url });
    const onActivated = (d: { tabId: number; windowId: number }) => void h.onTabActivated(d);
    const onFocusChanged = (windowId: number) => void h.onWindowFocusChanged(windowId);
    const onIdle = (state: string) => void h.onIdleStateChanged(state as IdleState);
    const onTabUpdated = (tabId: number, change: { title?: string }, tab: { url?: string }) => {
      if (change.title !== undefined && tab.url) void h.onTabTitleChanged({ tabId, url: tab.url, title: change.title });
    };
    const onTabRemoved = (tabId: number) => void h.onTabRemoved(tabId);
    const onWindowRemoved = (windowId: number) => void h.onWindowRemoved(windowId);
    const onStartup = () => void h.onBrowserStartup();
    const onAlarm = (alarm: { name: string }) => {
      if (alarm.name === TICK_ALARM) void h.onTick();
    };
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, respond: (reply?: unknown) => void) => {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      if (sender.frameId !== 0) {
        if (sender.documentLifecycle === 'active' && sender.documentId && isPageContentMessage(message) &&
          message.kind === 'screen' && message.hasPassword) {
          void passwordFrame(tabId, sender.documentId, h).then(() => respond(), () => respond());
          return true;
        }
        return;
      }
      if (isPageVisibilityMessage(message)) {
        void h.onPageVisibilityChanged({ tabId, visible: message.visible });
        return;
      }
      if (!sender.url || sender.documentLifecycle !== 'active' || !isPageContentMessage(message)) return;
      // Chrome can report the document's original sender URL after pushState.
      const senderOrigin = URL.parse(sender.url)?.origin;
      if (!senderOrigin || URL.parse(message.pageUrl)?.origin !== senderOrigin) return;
      h.onPageContent({ tabId, documentId: sender.documentId, url: message.pageUrl, content: message })
        .then(respond, () => respond());
      return true;
    };

    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.webNavigation.onHistoryStateUpdated.addListener(onHistoryStateUpdated);
    chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);
    chrome.idle.onStateChanged.addListener(onIdle);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    chrome.windows.onRemoved.addListener(onWindowRemoved);
    chrome.runtime.onStartup.addListener(onStartup);
    chrome.alarms.onAlarm.addListener(onAlarm);
    chrome.runtime.onMessage.addListener(onMessage);

    return () => {
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(onHistoryStateUpdated);
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(onCreatedNavigationTarget);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.windows.onFocusChanged.removeListener(onFocusChanged);
      chrome.idle.onStateChanged.removeListener(onIdle);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.tabs.onRemoved.removeListener(onTabRemoved);
      chrome.windows.onRemoved.removeListener(onWindowRemoved);
      chrome.runtime.onStartup.removeListener(onStartup);
      chrome.alarms.onAlarm.removeListener(onAlarm);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }

  async snapshot(): Promise<BrowserSnapshot> {
    const [activeTabs, focused, idleState] = await Promise.all([
      chrome.tabs.query({ active: true }),
      chrome.windows.getLastFocused().catch(() => null),
      chrome.idle.queryState(IDLE_SECONDS),
    ]);
    const activeTabByWindow: Record<number, number> = {};
    for (const tab of activeTabs) if (tab.id !== undefined) activeTabByWindow[tab.windowId] = tab.id;
    return {
      activeTabByWindow,
      focusedWindowId: focused?.focused && focused.id !== undefined ? focused.id : WINDOW_ID_NONE,
      idleState: idleState as IdleState,
    };
  }
}

/** Creates the periodic alarm that flushes active time (once; it persists across service-worker restarts). */
export async function ensureTickAlarm() {
  if (!(await chrome.alarms.get(TICK_ALARM))) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_PERIOD_MINUTES });
  }
}
