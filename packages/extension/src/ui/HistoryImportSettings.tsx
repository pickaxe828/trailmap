import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import {
  HISTORY_IMPORT_PORT, HISTORY_RANGES, isHistoryRange, isImportRunning,
  type HistoryImportRequest, type HistoryImportStatus, type HistoryRange,
} from '../history/messages';

function resultText(status: HistoryImportStatus): string {
  switch (status.state) {
    case 'done': return status.added === 0 ? 'No new Visits to import.' : `Imported ${visits(status.added)}.`;
    case 'cancelled': return status.added === 0 ? 'Import cancelled. No Visits were added.' : `Import cancelled. ${visits(status.added)} already imported will stay in your Journal.`;
    case 'paused': return 'Resume recording in Privacy before importing history.';
    case 'failed': return 'The import could not finish. You can try again without adding duplicates.';
    default: return '';
  }
}

const visits = (count: number) => `${count} ${count === 1 ? 'Visit' : 'Visits'}`;

export function HistoryImportSettings({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const [days, setDays] = useState<HistoryRange>('30');
  const [status, setStatus] = useState<HistoryImportStatus>({ state: 'idle' });
  const connection = useRef<chrome.runtime.Port | undefined>(undefined);
  const connect = useCallback(() => {
    if (connection.current) return connection.current;
    const port = chrome.runtime.connect({ name: HISTORY_IMPORT_PORT });
    connection.current = port;
    port.onMessage.addListener((next: HistoryImportStatus) => setStatus(next));
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (connection.current !== port) return;
      connection.current = undefined;
      setStatus((current) => isImportRunning(current) ? { state: 'failed' } : current);
    });
    return port;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      const port = connection.current;
      connection.current = undefined;
      port?.disconnect();
    };
  }, [connect]);

  function send(request: HistoryImportRequest) {
    try { connect().postMessage(request); } catch { setStatus({ state: 'failed' }); }
  }

  const running = isImportRunning(status);
  return (
    <VStack as="section" id="history-import" aria-label="History import" gap={2}>
      <Heading level={headingLevel}>History import</Heading>
      <Text as="p" type="supporting">Rebuild rough trails from URLs and titles in this browser. Trailmap skips denied sites and sites on your skip list, and does not fetch page text.</Text>
      <SegmentedControl label="History range" value={days} isDisabled={running} onChange={(value) => {
        if (isHistoryRange(value)) setDays(value);
      }}>
        {HISTORY_RANGES.map((range) => <SegmentedControlItem key={range} value={range} label={`${range} days`} />)}
      </SegmentedControl>
      {running && (status.state === 'writing' && status.total > 0
        ? <ProgressBar label="Rebuilding trails" value={status.processed} max={status.total} hasValueLabel />
        : <ProgressBar label={status.state === 'cancelling' ? 'Cancelling import…' : 'Reading browser history…'} isIndeterminate />)}
      <HStack gap={2}>
        <Button label="Import history" variant="secondary" isDisabled={running} onClick={() => send({ type: 'start', days })} />
        {running && <Button label="Cancel import" variant="secondary" isDisabled={status.state === 'cancelling'} onClick={() => send({ type: 'cancel' })} />}
      </HStack>
      <Text role="status" type="supporting">{resultText(status)}</Text>
    </VStack>
  );
}
