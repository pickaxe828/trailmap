import { useEffect, useState } from 'react';
import { correct } from '../../corrections/client';
import { PASSWORD_STATUS_CHANGED } from '../../privacy/messages';
import { recordingState, type RecordingSettings } from '../../privacy/policy';
import { readRecordingSettings, RECORDING_SETTINGS_KEY } from '../../privacy/settings';

/** The Visit shown in the browser's active tab, kept fresh as tabs and the trail change. */
export function useCurrentVisitId(trailVersion: unknown): string | null {
  const [visitId, setVisitId] = useState<string | null>(null);
  useEffect(() => {
    let requestId = 0;
    const refresh = () => {
      const id = ++requestId;
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const reply = tab?.id === undefined || tab.incognito ? null : await correct('current-visit', { tabId: tab.id });
        if (id === requestId) setVisitId(typeof reply === 'string' ? reply : null);
      })().catch(() => { if (id === requestId) setVisitId(null); });
    };
    const tabActivated = () => {
      setVisitId(null); // Never let input intended for the new tab reach the old editor.
      refresh();
    };
    const tabUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_, change, tab) => {
      if (tab.active && (change.url || change.status)) refresh();
    };
    const settingsChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && changes[RECORDING_SETTINGS_KEY]) refresh();
    };
    const passwordChanged = (message: { type?: string }) => {
      if (message?.type === PASSWORD_STATUS_CHANGED) refresh();
    };
    chrome.tabs.onActivated.addListener(tabActivated);
    chrome.tabs.onUpdated.addListener(tabUpdated);
    chrome.windows.onFocusChanged.addListener(refresh);
    chrome.storage.onChanged.addListener(settingsChanged);
    chrome.runtime.onMessage.addListener(passwordChanged);
    refresh();
    return () => {
      requestId++;
      chrome.tabs.onActivated.removeListener(tabActivated);
      chrome.tabs.onUpdated.removeListener(tabUpdated);
      chrome.windows.onFocusChanged.removeListener(refresh);
      chrome.storage.onChanged.removeListener(settingsChanged);
      chrome.runtime.onMessage.removeListener(passwordChanged);
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
