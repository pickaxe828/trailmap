import type { ChatSite } from './chat-sites';
import type { IdleState } from './events';
import { WINDOW_ID_NONE } from './events';

/**
 * Everything the recorder needs to keep attributing parents and active time
 * after the MV3 service worker is killed and restarted (docs/PLAN.md §4.1).
 * It is plain JSON so any key-value store can hold it.
 */
export type RecorderState = {
  version: 1;
  /** Each tab's current Visit id. This is what parents are taken from. */
  currentVisitByTab: Record<number, string>;
  /** Document ids distinguish successive visits with the same URL, such as reloads. */
  documentIdsByTab?: Record<number, string>;
  /** Mode entry is not a Visit until a composer submission. Do not keep its query URL. */
  aiEntries?: Record<number, {
    origin: string;
    documentId?: string;
    parentVisitId: string | null;
    screened: boolean;
    carryReply?: true;
    /** An opted-in chat site (no query URL or chat id is kept). `fresh`: still on its new-chat page. */
    chat?: ChatSite;
    fresh?: true;
  }>;
  /** Browser-session tab ids only; never store a password page's URL. */
  passwordTabs?: number[];
  passwordDocumentIdsByTab?: Record<number, string>;
  /**
   * Tabs opened from a link, mapped to the Visit that was current in the source
   * tab (`null` if it had none). Consumed by the new tab's first commit.
   */
  pendingNewTabParent: Record<number, string | null>;
  pendingAiCitationParent?: Record<number, string>;
  activeTabByWindow: Record<number, number>;
  focusedWindowId: number;
  idleState: IdleState;
  /** Tabs whose page last reported `document.visibilityState === 'hidden'`. */
  hiddenTabs: number[];
  /** When active time was last settled. Inputs are constant between events, so the gap since this is exact. */
  lastSettledAt: number | null;
};

export function emptyRecorderState(): RecorderState {
  return {
    version: 1,
    currentVisitByTab: {},
    pendingNewTabParent: {},
    activeTabByWindow: {},
    focusedWindowId: WINDOW_ID_NONE,
    idleState: 'active',
    hiddenTabs: [],
    lastSettledAt: null,
  };
}

/** Where `RecorderState` lives. `chrome.storage.session` in the extension, memory in tests. */
export interface RecorderStateStore {
  load(): Promise<RecorderState | null>;
  save(state: RecorderState): Promise<void>;
}

export class MemoryStateStore implements RecorderStateStore {
  private state: RecorderState | null = null;
  async load() {
    return this.state ? structuredClone(this.state) : null;
  }
  async save(state: RecorderState) {
    this.state = structuredClone(state);
  }
}
