import { HStack } from '@astryxdesign/core/HStack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState } from 'react';
import { PASSWORD_STATUS_CHANGED, RECORDING_MESSAGE, type RecordingRequest, type RecordingStatus } from './messages';
import { RECORDING_SETTINGS_KEY } from './settings';

async function currentStatus(activeSite: boolean): Promise<RecordingStatus | undefined> {
  const [tab] = activeSite ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
  return chrome.runtime.sendMessage({ type: RECORDING_MESSAGE, action: 'status', tabId: tab?.id } satisfies RecordingRequest);
}

export function RecordingControls({ activeSite = true }: { activeSite?: boolean }) {
  const [status, setStatus] = useState<RecordingStatus>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let requestId = 0;
    const refresh = () => {
      const id = ++requestId;
      void currentStatus(activeSite).then((next) => {
        if (id === requestId && next) setStatus(next);
      }).catch(() => {
        if (id === requestId) setFailed(true);
      });
    };
    const tabUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_, change, tab) => {
      if (tab.active && change.url) refresh();
    };
    const storageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && changes[RECORDING_SETTINGS_KEY]) refresh();
    };
    const passwordChanged = (message: { type?: string }) => {
      if (message?.type === PASSWORD_STATUS_CHANGED) refresh();
    };
    if (activeSite) {
      chrome.tabs.onActivated.addListener(refresh);
      chrome.tabs.onUpdated.addListener(tabUpdated);
      chrome.windows.onFocusChanged.addListener(refresh);
      chrome.runtime.onMessage.addListener(passwordChanged);
    }
    chrome.storage.onChanged.addListener(storageChanged);
    refresh();
    return () => {
      requestId++;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(tabUpdated);
      chrome.windows.onFocusChanged.removeListener(refresh);
      chrome.storage.onChanged.removeListener(storageChanged);
      chrome.runtime.onMessage.removeListener(passwordChanged);
    };
  }, [activeSite]);

  async function change(request: RecordingRequest) {
    setFailed(false);
    try {
      if (!await chrome.runtime.sendMessage(request)) setFailed(true);
    } catch {
      setFailed(true);
    }
  }

  if (!status) return <Text type="supporting">{failed ? 'Recording controls unavailable' : 'Checking recording…'}</Text>;
  const { paused, site } = status;
  return (
    <VStack gap={1}>
      <HStack gap={3} align="center" wrap="wrap" className="wrap-anywhere">
        <Switch size="sm" label="Record browsing" value={!paused}
          description={paused && !activeSite ? 'Recording resumes on the next navigation.' : undefined}
          changeAction={(checked) => change({ type: RECORDING_MESSAGE, action: 'set-pause', paused: !checked })} />
        {site && (
          <Switch size="sm" label={`Record ${site.host}`} value={!site.skipped} isDisabled={!site.editable}
            disabledMessage={!site.editable ? 'This page is protected by a privacy filter.' : undefined}
            changeAction={(checked) => change({ type: RECORDING_MESSAGE, action: 'set-site', tabId: site.tabId, host: site.host, skip: !checked })} />
        )}
      </HStack>
      {failed && <Text type="supporting">Could not update recording settings.</Text>}
    </VStack>
  );
}
