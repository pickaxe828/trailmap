import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Visit } from '@trailmap/shared';
import type { ExpeditionReview } from '../../journal/data';
import { webUrl } from '../../ui/web-url';

export function visitTitle(visit: Visit): string {
  return visit.title || webUrl(visit.url)?.hostname || 'Untitled Visit';
}

export function StopDetails({ review, selected, onSelect, onMove, onClose }: {
  review: ExpeditionReview;
  selected: string;
  onSelect: (id: string) => void;
  onMove?: (visit: Visit) => void;
  onClose: () => void;
}) {
  const stop = review.graph.nodes.find(({ id }) => id === selected);
  const members = stop?.kind === 'skipped' ? stop.visits : undefined;
  const visit = stop && stop.kind !== 'skipped' ? stop.visit : review.visits.find(({ id }) => id === selected);
  if (!stop && !visit) return null;
  const url = visit && webUrl(visit.url);
  const page = visit && review.pageNotes.get(visit.canonicalUrl);
  const title = stop?.kind === 'question' ? stop.query.q : members ? `+${members.length} skipped`
    : visit ? visitTitle(visit) : 'Trail stop';
  return (
    <VStack as="section" aria-label="Trail stop details" gap={2} paddingBlockEnd={4} className="border-b border-border">
      <HStack justify="between" align="center" gap={2}>
        <Heading level={2}>{title}</Heading>
        <Button variant="ghost" size="sm" label="Close details" onClick={onClose} />
      </HStack>
      {members ? (
        <VStack gap={1} hAlign="start">
          <Text type="supporting">These pages were opened but not read.</Text>
          {members.map((member) => <Button key={member.id} variant="ghost" label={visitTitle(member)} onClick={() => onSelect(member.id)} />)}
        </VStack>
      ) : (
        <>
          {page?.summary ? <Text as="p">{page.summary}</Text> : <Text type="supporting">No page summary yet.</Text>}
          {!!page?.takeaways.length && (
            <>
              <Heading level={3}>Takeaways</Heading>
              <VStack as="ul" gap={1} className="list-disc ps-4">
                {page.takeaways.map((takeaway, i) => <li key={i}><Text>{takeaway}</Text></li>)}
              </VStack>
            </>
          )}
          <HStack gap={2} wrap="wrap">
            {url && <Button label="Reopen page" size="sm" href={url.href} target="_blank" rel="noopener noreferrer" />}
            {visit && onMove && <Button label="Move page" size="sm" variant="ghost" onClick={() => onMove(visit)} />}
          </HStack>
        </>
      )}
    </VStack>
  );
}
