import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible, CollapsibleGroup } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { liveQuery } from 'dexie';
import { openTrailmapDb, type SentToModel } from '../../db/db';
import { modelTaskLabel } from '../../jobs/labels';
import { exportModelLog } from '../../llm/export';
import { download } from '../../ui/download';

const PAGE_SIZE = 20;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

function status({ task, outcome, errorCode }: SentToModel) {
  if (task === 'forgotten') return 'Local entry';
  switch (outcome) {
    case 'pending': return 'In progress';
    case 'succeeded': return 'Succeeded';
    case 'failed': return `Failed${errorCode ? `: ${errorCode}` : ''}`;
    case 'cancelled': return 'Cancelled';
    default: return 'Outcome not recorded';
  }
}

export function SentToModelLog() {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [snapshot, setSnapshot] = useState<{ entries: SentToModel[]; total: number }>();
  const [requested, setRequested] = useState(50);
  const [redactText, setRedactText] = useState(true);
  const [includeJobs, setIncludeJobs] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    const db = openTrailmapDb();
    const subscription = liveQuery(() => db.transaction('r', db.sentToModel, async () => ({
      entries: await db.sentToModel.orderBy('at').reverse().limit(limit + 1).toArray(),
      total: await db.sentToModel.count(),
    }))).subscribe({ next: setSnapshot });
    return () => { subscription.unsubscribe(); db.close(); };
  }, [limit]);
  const { entries, total = 0 } = snapshot ?? {};
  const count = Math.min(requested, total);
  const invalidCount = total > 0 && count < 1;

  async function exportCalls() {
    if (count < 1) return;
    setExportError('');
    const db = openTrailmapDb();
    try {
      const blob = await exportModelLog(db, count, redactText, includeJobs);
      download(blob, `trailmap-model-log-${new Date().toISOString().slice(0, 10)}.jsonl`);
    } catch {
      setExportError('Could not export the Sent-to-model log. Try again.');
    } finally {
      db.close();
    }
  }

  return (
    <VStack as="section" aria-labelledby="sent-to-model" gap={2}>
      <HStack gap={2} wrap="wrap" align="center" justify="between">
        <Heading level={2} id="sent-to-model">Sent-to-model log</Heading>
        <Button label="Export" variant="secondary" isDisabled={count < 1} clickAction={exportCalls} />
      </HStack>
      <Text as="p">
        This log is stored in this browser. It records the exact text and provider for each model attempt, including retries and failed calls.
        Entries are written immediately before sending; a connection loss can prevent delivery.
      </Text>
      {total > 0 && <VStack gap={1}>
        <NumberInput label="Last calls" value={count} max={total} isIntegerOnly isWheelEnabled={false}
          onChange={setRequested} status={invalidCount ? { type: 'error', message: 'Select at least one call.' } : undefined} />
        <CheckboxInput label="Leave out page text" value={redactText} onChange={setRedactText} />
        <Text as="p" type="supporting">{redactText
          ? 'The file keeps URLs and identifiers, but replaces instructions, input, and output with lengths and hashes.'
          : 'The file will contain the text of the pages sent and the model replies. Only share it with people you trust.'}</Text>
        <CheckboxInput label="Include matching job diagnostics" value={includeJobs} onChange={setIncludeJobs} />
      </VStack>}
      {exportError && <Text role="alert">{exportError}</Text>}
      {entries?.length === 0 && <Text type="supporting">No model calls yet.</Text>}
      {!!entries?.length && <CollapsibleGroup type="single" hasDividers>
        {entries.slice(0, limit).map((entry) => (
          <Collapsible key={entry.id} value={entry.id} trigger={<Text weight="semibold">
            {date.format(entry.at)} · {entry.provider} · {modelTaskLabel(entry.task)} · {status(entry)}
          </Text>}>
            <VStack gap={2} className="whitespace-pre-wrap wrap-anywhere">
              {entry.task === 'forgotten' ? <Text as="p">{entry.instructions}</Text> : <>
                <Text type="supporting">Model: {entry.model}</Text>
                {entry.finishedAt !== undefined && <Text type="supporting">Finished: {date.format(entry.finishedAt)}</Text>}
                <Heading level={3}>Sent</Heading>
                <Text type="label">Instructions</Text>
                <Text as="p" type="code">{entry.instructions}</Text>
                {entry.input.map(({ role, content }, index) => (
                  <VStack key={index} gap={1}>
                    <Text type="label">{role === 'user' ? 'Input' : 'Previous model reply'}</Text>
                    <Text as="p" type="code">{content}</Text>
                  </VStack>
                ))}
                <Heading level={3}>Returned</Heading>
                {entry.output === undefined ? <Text type="supporting">No reply recorded.</Text> :
                  <Text as="p" type="code">{entry.outcome === 'failed' && typeof entry.output === 'string'
                    ? entry.output : JSON.stringify(entry.output, null, 2)}</Text>}
              </>}
            </VStack>
          </Collapsible>
        ))}
      </CollapsibleGroup>}
      {entries && entries.length > limit && <Button label="Show more calls" onClick={() => setLimit(limit + PAGE_SIZE)} />}
    </VStack>
  );
}
