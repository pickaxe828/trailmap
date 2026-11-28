import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { DateInput } from '@astryxdesign/core/DateInput';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { TrailGraphView } from '../../trail/TrailGraphView';
import { localDateKey, useDayTrail } from '../../trail/useDayTrail';
import { TrailmapShell } from '../../ui/TrailmapShell';

export function App() {
  const now = new Date();
  const today = localDateKey(now);
  const yesterday = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const [day, setDay] = useState(today);
  const trail = useDayTrail(day);

  return (
    <TrailmapShell title="Trail" section="trail" description="See how one page led to the next." actions={
      <HStack align="center" wrap="wrap" gap={2}>
        <Button label="Yesterday" size="sm" variant={day === yesterday ? 'primary' : 'secondary'}
          aria-pressed={day === yesterday} onClick={() => setDay(yesterday)} />
        <Button label="Today" size="sm" variant={day === today ? 'primary' : 'secondary'}
          aria-pressed={day === today} onClick={() => setDay(today)} />
        <DateInput label="Trail day" isLabelHidden size="sm" format="date_weekday" value={day} max={today}
          containerClassName="w-48" onChange={(value) => { if (value) setDay(value); }} />
      </HStack>
    }>
      <VStack as="section" aria-label="Browsing trail" className="relative min-h-80 grow">
        <VStack className="absolute inset-0">
          {trail && 'graph' in trail && trail.graph.nodes.length > 0 ? <TrailGraphView key={day} graph={trail.graph} /> : (
            <Center height="100%" padding={6}>
              {!trail ? <Text type="supporting">Loading your trail…</Text> : 'error' in trail ? (
                <Text type="supporting">Could not load this trail. Try reloading the page.</Text>
              ) : (
                <EmptyState headingLevel={2} title="No browsing on this day"
                  description="Pick another day or browse to start a trail today." />
              )}
            </Center>
          )}
        </VStack>
      </VStack>
    </TrailmapShell>
  );
}
