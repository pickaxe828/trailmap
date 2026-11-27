import { useEffect, useState } from 'react';
import { readReviewSettings, REVIEW_SETTINGS_KEY, type ReviewSettings } from './settings';

/** The saved review settings, kept current across tabs. `undefined` until read (and if storage is unavailable). */
export function useReviewSettings(): ReviewSettings | undefined {
  const [settings, setSettings] = useState<ReviewSettings>();
  useEffect(() => {
    let mounted = true;
    const read = () => void readReviewSettings().then((value) => { if (mounted) setSettings(value); }).catch(() => {});
    const changed: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && REVIEW_SETTINGS_KEY in changes) read();
    };
    read();
    chrome.storage?.onChanged.addListener(changed);
    return () => { mounted = false; chrome.storage?.onChanged.removeListener(changed); };
  }, []);
  return settings;
}
