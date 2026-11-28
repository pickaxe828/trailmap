import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useLayoutEffect, useRef, useState } from 'react';
import { expeditionHref, formatExpeditionDate } from '../../journal/links';
import type { Recurrence, ThreadReview } from '../../threads/read';
import { TrailGraphView } from '../../trail/TrailGraphView';

const sessionAnchor = (id: string) => `session:${id}`;

function RecurrenceLines({ recurrences }: { recurrences: Recurrence[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [geometry, setGeometry] = useState<{ height: number; anchors: Map<string, number> }>();
  useLayoutEffect(() => {
    const rail = svg.current;
    const list = rail?.parentElement;
    if (!rail || !list) return;
    const anchors = [...list.querySelectorAll<HTMLElement>('[data-session-anchor]')];
    const measure = () => {
      const { height, top } = rail.getBoundingClientRect();
      setGeometry({ height, anchors: new Map(anchors.map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return [anchor.dataset.sessionAnchor!, rect.top + rect.height / 2 - top];
      })) });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const anchor of anchors) if (anchor.parentElement) observer.observe(anchor.parentElement);
    measure();
    return () => observer.disconnect();
  }, [recurrences]);
  return (
    <svg ref={svg} className="pointer-events-none absolute inset-y-0 start-0 h-full w-8 text-accent" aria-hidden="true"
      viewBox={`0 0 100 ${geometry?.height || 1}`} preserveAspectRatio="none">
      {recurrences.map(({ from, to }, index) => {
        const start = geometry?.anchors.get(from);
        const end = geometry?.anchors.get(to);
        if (start === undefined || end === undefined) return null;
        const lane = 18 + index % 5 * 12;
        return <path key={JSON.stringify([from, to])} d={`M 98 ${start} H ${lane} V ${end} H 98`}
          fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

export function SessionTimeline({ sessions, recurrences, noted, onDetach }: Pick<ThreadReview, 'sessions' | 'recurrences' | 'noted'> & {
  onDetach: (id: string) => void;
}) {
  const titles = new Map(sessions.map(({ expedition }) => [expedition.id, expedition.title]));
  return (
    <VStack as="section" gap={4} aria-label="Session timeline">
      <VStack gap={1}>
        <Heading level={2}>Sessions</Heading>
        <Text type="supporting">Oldest first. Lines show pages and concepts that came up again.</Text>
      </VStack>
      <VStack gap={6} className="relative ps-8" role="list">
        <RecurrenceLines recurrences={recurrences} />
        {sessions.map(({ expedition, graph }) => (
          <VStack key={expedition.id} role="listitem" id={sessionAnchor(expedition.id)} gap={2} className="min-w-0">
            <HStack gap={2} justify="between" wrap="wrap" data-session-anchor={expedition.id}>
              <VStack gap={1}>
                <HStack gap={2} wrap="wrap" data-my-notes={noted.has(expedition.id) ? 'written' : 'none'}>
                  <Text type="supporting">{formatExpeditionDate(expedition.startedAt)}</Text>
                  {noted.has(expedition.id) ? <Text type="label" color="accent">My notes</Text> : <Text type="supporting">No notes yet</Text>}
                </HStack>
                <Heading level={3} maxLines={2} className="wrap-anywhere"><Link hasUnderline className={noted.has(expedition.id) ? undefined : 'text-secondary'} href={expeditionHref(expedition.id)}>{expedition.title}</Link></Heading>
              </VStack>
              <Button variant="destructive" size="sm" label="Detach session" onClick={() => onDetach(expedition.id)} />
            </HStack>
            {recurrences.filter(({ to }) => to === expedition.id).map(({ from, pages, concepts }) => (
              <VStack gap={1} key={from} padding={2} className="rounded-lg border border-border bg-card">
                <Text type="supporting">From <Link hasUnderline href={`#${encodeURIComponent(sessionAnchor(from))}`}>{titles.get(from)}</Link></Text>
                {!!pages.length && <Text type="supporting">Revisited: {pages.join(', ')}</Text>}
                {!!concepts.length && <Text type="supporting">Concepts returned: {concepts.join(', ')}</Text>}
              </VStack>
            ))}
            {graph.nodes.length > 0 ? (
              <VStack height="clamp(14rem, 32dvh, 24rem)" className="overflow-hidden rounded-lg border border-border bg-card">
                <TrailGraphView graph={graph} />
              </VStack>
            ) : <Text type="supporting">This session has no recorded stops.</Text>}
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
}
