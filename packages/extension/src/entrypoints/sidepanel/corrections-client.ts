import { useEffect, useState } from 'react';
import { CORRECTION_MESSAGE, type CorrectionRequest } from '../../corrections/messages';
import { recordingState, type RecordingSettings } from '../../privacy/policy';
import { readRecordingSettings, RECORDING_SETTINGS_KEY } from '../../privacy/settings';

type Action = CorrectionRequest extends infer R ? R extends { action: infer A } ? A : never : never;
type Body<A extends Action> = Omit<Extract<CorrectionRequest, { action: A }>, 'type' | 'action'>;

/** Sends a correction to the service worker. Resolves to its reply, or false if it failed. */
export async function correct<A extends Action>(action: A, body: Body<A>): Promise<boolean | string | null> {
  try {
    return await chrome.runtime.sendMessage({ type: CORRECTION_MESSAGE, action, ...body } as unknown as CorrectionRequest);
  } catch {
    return false;
  }
}

/** The Visit shown in the browser's active tab, kept fresh as tabs and the trail change. */
export function useCurrentVisitId(trailVersion: unknown): string | null {
  const [visitId, setVisitId] = useState<string | null>(null);
  useEffect(() => {
    let requestId = 0;
    const refresh = () => {
      const id = ++requestId;
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const reply = tab?.id === undefined ? null : await correct('current-visit', { tabId: tab.id });
        if (id === requestId) setVisitId(typeof reply === 'string' ? reply : null);
      })().catch(() => {});
    };
    const tabUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_, change, tab) => {
      if (tab.active && (change.url || change.status)) refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(tabUpdated);
    chrome.windows.onFocusChanged.addListener(refresh);
    refresh();
    return () => {
      requestId++;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(tabUpdated);
      chrome.windows.onFocusChanged.removeListener(refresh);
    };
  }, [trailVersion]);
  return visitId;
}

/** Whether recording already skips a URL's site (ticket 08's skip list, read-only here). */
export function useSiteSkipped(): (url: string) => boolean {
  const [settings, setSettings] = useState<RecordingSettings>({ paused: false, skippedHosts: [] });
  useEffect(() => {
    void readRecordingSettings().then(setSettings).catch(() => {});
    const changed: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && changes[RECORDING_SETTINGS_KEY]) void readRecordingSettings().then(setSettings).catch(() => {});
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  return (url) => recordingState(url, { ...settings, paused: false }) === 'skipped';
}
