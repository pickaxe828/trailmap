import { AppShell } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { DateInput } from '@astryxdesign/core/DateInput';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { TrailGraphView } from '../../trail/TrailGraphView';
import { localDateKey, useDayTrail } from '../../trail/useDayTrail';

export function App() {
  const now = new Date();
  const today = localDateKey(now);
  const yesterday = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const [day, setDay] = useState(today);
  const trail = useDayTrail(day);

  return (
    <AppShell variant="surface" contentPadding={0} mobileNav={false}
      topNav={<TopNav label="Trailmap" heading={<TopNavHeading heading="Trailmap" />} />}
    >
      <VStack height="100%">
        <HStack paddingInline={6} paddingBlock={4} justify="between" align="center" wrap="wrap" gap={4}
          as="header" className="border-b border-border">
          <VStack gap={1}>
            <Heading level={1}>Trail</Heading>
            <Text type="supporting">See how one page led to the next.</Text>
          </VStack>
          <HStack align="center" wrap="wrap" gap={2}>
            <Button label="Yesterday" size="sm" variant={day === yesterday ? 'primary' : 'secondary'}
              aria-pressed={day === yesterday} onClick={() => setDay(yesterday)} />
            <Button label="Today" size="sm" variant={day === today ? 'primary' : 'secondary'}
              aria-pressed={day === today} onClick={() => setDay(today)} />
            <DateInput label="Trail day" isLabelHidden size="sm" format="date_weekday" value={day} max={today}
              containerClassName="w-48" onChange={(value) => { if (value) setDay(value); }} />
          </HStack>
        </HStack>
        <VStack as="section" aria-label="Browsing trail" className="min-h-0 flex-1 bg-body">
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
    </AppShell>
  );
}
