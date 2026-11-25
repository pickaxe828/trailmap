import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible, CollapsibleGroup } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { liveQuery } from 'dexie';
import { openTrailmapDb, type SentToModel } from '../../db/db';

const PAGE_SIZE = 20;
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export function SentToModelLog() {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [entries, setEntries] = useState<SentToModel[]>();
  useEffect(() => {
    if (location.hash === '#sent-to-model') document.getElementById('sent-to-model')?.scrollIntoView();
  }, []);
  useEffect(() => {
    const db = openTrailmapDb();
    const subscription = liveQuery(() => db.sentToModel.orderBy('at').reverse().limit(limit + 1).toArray())
      .subscribe({ next: setEntries });
    return () => { subscription.unsubscribe(); db.close(); };
  }, [limit]);

  return (
    <VStack as="section" aria-labelledby="sent-to-model" gap={2}>
      <Heading level={3} id="sent-to-model">Sent-to-model log</Heading>
      <Text as="p">
        This log is stored in this browser. It records the exact text and provider for each model attempt, including retries and failed calls.
        Entries are written immediately before sending; a connection loss can prevent delivery.
      </Text>
      {entries?.length === 0 && <Text type="supporting">No model calls yet.</Text>}
      {!!entries?.length && <CollapsibleGroup type="single" hasDividers>
        {entries.slice(0, limit).map(({ id, at, provider, model, task, instructions, input }) => (
          <Collapsible key={id} value={id} trigger={<Text weight="semibold">
            {date.format(at)} · {provider} · {task.replaceAll('_', ' ')}
          </Text>}>
            <VStack gap={2} className="whitespace-pre-wrap">
              <Text type="supporting">Model: {model}</Text>
              <Text type="label">Instructions</Text>
              <Text as="p" type="code">{instructions}</Text>
              {input.map(({ role, content }, index) => (
                <VStack key={index} gap={1}>
                  <Text type="label">{role === 'user' ? 'Input' : 'Previous model reply'}</Text>
                  <Text as="p" type="code">{content}</Text>
                </VStack>
              ))}
            </VStack>
          </Collapsible>
        ))}
      </CollapsibleGroup>}
      {entries && entries.length > limit && <Button label="Show more calls" onClick={() => setLimit(limit + PAGE_SIZE)} />}
    </VStack>
  );
}
