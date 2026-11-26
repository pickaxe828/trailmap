import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState, type SubmitEvent } from 'react';
import { MAX_EXPEDITION_MINUTES, MIN_EXPEDITION_MINUTES } from '../segmentation/config';
import { DENIED_HOSTS } from './default-deny-list';
import { RECORDING_MESSAGE, type RecordingRequest } from './messages';
import { RecordingControls } from './RecordingControls';
import { expeditionCloseSettings, readRecordingSettings, RECORDING_SETTINGS_KEY, type ExpeditionThreshold } from './settings';

export function PrivacySettings() {
  const [input, setInput] = useState('');
  const [hosts, setHosts] = useState<string[]>();
  const [thresholds, setThresholds] = useState<ReturnType<typeof expeditionCloseSettings>>();
  const [thresholdError, setThresholdError] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let revision = 0;
    const read = () => {
      const current = ++revision;
      void readRecordingSettings().then(
        (settings) => {
          if (revision !== current) return;
          setHosts(settings.skippedHosts);
          setThresholds(expeditionCloseSettings(settings));
          setReadFailed(false);
        },
        () => { if (revision === current) setReadFailed(true); },
      );
    };
    const changed: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && changes[RECORDING_SETTINGS_KEY]) read();
    };
    chrome.storage.onChanged.addListener(changed);
    read();
    return () => { revision++; chrome.storage.onChanged.removeListener(changed); };
  }, []);

  async function saveThreshold(threshold: ExpeditionThreshold, minutes: number) {
    setThresholdError(false);
    try {
      const saved = await chrome.runtime.sendMessage({
        type: RECORDING_MESSAGE, action: 'set-expedition-threshold', threshold, minutes,
      } satisfies RecordingRequest);
      if (!saved) throw new Error();
    } catch {
      setThresholdError(true);
    }
  }

  async function edit(site: string, skip: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await chrome.runtime.sendMessage({
        type: RECORDING_MESSAGE, action: 'edit-skip-list', site, skip,
      } satisfies RecordingRequest);
      if (!saved) throw new Error();
      if (skip) setInput('');
    } catch {
      setError(skip ? 'Could not add the site. Enter a hostname or an HTTP(S) URL.' : 'Could not remove the site.');
    } finally {
      setBusy(false);
    }
  }

  function add(event: SubmitEvent<HTMLElement>) {
    event.preventDefault();
    if (hosts && !busy && input.trim()) void edit(input, true);
  }

  return (
    <VStack as="section" id="privacy" aria-labelledby="privacy-title" gap={3}>
      <Heading level={2} id="privacy-title">Privacy</Heading>
      <Text as="p">Trailmap keeps a local record of the pages you visit, the links you follow, reading time, page text, search queries, and text you select or copy.</Text>
      <Text as="p" type="supporting">Private sites are skipped by default. If you enable a cloud model, eligible browsing content is sent to that provider to write notes. Ollama processes it on this computer.</Text>
      <RecordingControls activeSite={false} />
      <VStack gap={2}>
        <Heading level={3}>Automatic Expedition close</Heading>
        <NumberInput label="Expedition inactivity" units="minutes" min={MIN_EXPEDITION_MINUTES} max={MAX_EXPEDITION_MINUTES}
          description="Close an Expedition after this long without a new Visit or reading time."
          isIntegerOnly isWheelEnabled={false} isDisabled={!thresholds} value={thresholds?.expeditionInactivityMinutes}
          onChange={(minutes) => void saveThreshold('expeditionInactivityMinutes', minutes)} />
        <NumberInput label="Topic switch" units="minutes" min={MIN_EXPEDITION_MINUTES} max={MAX_EXPEDITION_MINUTES}
          description="When a new Expedition starts, close others inactive for at least this long."
          isIntegerOnly isWheelEnabled={false} isDisabled={!thresholds} value={thresholds?.topicSwitchMinutes}
          onChange={(minutes) => void saveThreshold('topicSwitchMinutes', minutes)} />
        {thresholdError && <Text role="alert">Could not save the Expedition close setting.</Text>}
      </VStack>
      <Collapsible trigger="Default skip list" defaultIsOpen={false}>
        <VStack gap={2} paddingBlockEnd={2}>
          <Text as="p">Trailmap skips password pages, private networks and local sites, checkout and payment pages, and common mail, calendar, chat and banking subdomains.</Text>
          <HStack as="ul" gap={2} wrap="wrap">
            {DENIED_HOSTS.map((host) => <li key={host}><Text type="supporting">{host}</Text></li>)}
          </HStack>
        </VStack>
      </Collapsible>
      <VStack gap={2}>
        <Heading level={3}>Your skipped sites</Heading>
        <Text as="p" type="supporting">A skip covers the site and its subdomains. It does not erase existing Visits.</Text>
        <HStack as="form" align="end" gap={2} wrap="wrap" onSubmit={add}>
          <TextInput label="Site to skip" placeholder="example.com" autoComplete="off" hasSpellCheck={false}
            isReadOnly={busy} value={input} onChange={setInput} />
          <Button label="Add site" type="submit" variant="secondary" isDisabled={!hosts || busy || !input.trim()} />
        </HStack>
        {hosts?.length === 0 && <Text type="supporting">No extra sites skipped.</Text>}
        {hosts && hosts.length > 0 && (
          <VStack as="ul" gap={1}>
            {hosts.map((host) => (
              <HStack as="li" key={host} gap={2} align="center" wrap="wrap">
                <Text>{host}</Text>
                <Button label="Remove" aria-label={`Remove ${host} from skip list`} size="sm" variant="ghost"
                  isDisabled={busy} clickAction={() => edit(host, false)} />
              </HStack>
            ))}
          </VStack>
        )}
        {readFailed && <Text role="alert">Could not read your recording settings.</Text>}
        {error && <Text role="alert">{error}</Text>}
      </VStack>
    </VStack>
  );
}
