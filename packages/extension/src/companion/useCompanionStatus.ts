import { useEffect, useState } from 'react';
import type { CompanionStatus } from './client';
import { COMPANION_RECONNECT_MESSAGE, COMPANION_STATUS_KEY, INITIAL_COMPANION_STATUS } from './status';

/** Live companion status for UI pages. Also nudges the background to retry the connection when the page opens. */
export function useCompanionStatus(): CompanionStatus {
  const [status, setStatus] = useState<CompanionStatus>(INITIAL_COMPANION_STATUS);

  useEffect(() => {
    void chrome.storage.session.get(COMPANION_STATUS_KEY).then((stored) => {
      const value = stored[COMPANION_STATUS_KEY] as CompanionStatus | undefined;
      if (value) setStatus(value);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes[COMPANION_STATUS_KEY];
      if (area === 'session' && change?.newValue) setStatus(change.newValue as CompanionStatus);
    };
    chrome.storage.onChanged.addListener(onChanged);
    void chrome.runtime.sendMessage({ type: COMPANION_RECONNECT_MESSAGE }).catch(() => {});
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return status;
}
