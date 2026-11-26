import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { AiTurn, Visit } from '@trailmap/shared';
import { OPEN_AI_CITATION } from '../../capture/page-messages';
import type { ExpeditionReview } from '../../journal/data';
import { webUrl } from '../../ui/web-url';

export function visitTitle(visit: Visit): string {
  return visit.title || webUrl(visit.url)?.hostname || 'Untitled Visit';
}

function AiConversation({ turns, visitId }: { turns: AiTurn[]; visitId: string }) {
  const citations = [...new Set(turns.flatMap((turn) => turn.citations))].flatMap((href) => webUrl(href) ?? []);
  return (
    <VStack gap={2}>
      <Text type="supporting">AI conversation · AI-generated answers, not an independent source.</Text>
      {turns.map(({ id, question, answer }) => (
        <VStack key={id} gap={1}>
          <Text as="p" weight="semibold">{question}</Text>
          {answer && <Text as="p" className="whitespace-pre-line">{answer}</Text>}
        </VStack>
      ))}
      {!!citations.length && (
        <VStack gap={1} hAlign="start">
          <Heading level={3}>Cited sources</Heading>
          {citations.map((url) => (
            <Link key={url.href} href={url.href} isExternalLink isStandalone tooltip={url.href}
              onClick={(event) => {
                event.preventDefault();
                void chrome.runtime.sendMessage({ type: OPEN_AI_CITATION, visitId, url: url.href,
                  background: event.ctrlKey || event.metaKey }).catch(() => {});
              }}>
              {url.hostname}{url.pathname === '/' ? '' : url.pathname}
            </Link>
          ))}
        </VStack>
      )}
    </VStack>
  );
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
          {visit?.aiConversation && <AiConversation visitId={visit.id} turns={page?.aiTurns ?? []} />}
          {page?.summary ? <Text as="p">{page.summary}</Text> : !visit?.aiConversation && <Text type="supporting">No page summary yet.</Text>}
          {!!page?.takeaways.length && (
            <>
              <Heading level={3}>Takeaways</Heading>
              <VStack as="ul" gap={1} className="list-disc ps-4">
                {page.takeaways.map((takeaway, i) => <li key={i}><Text>{takeaway}</Text></li>)}
              </VStack>
            </>
          )}
          <HStack gap={2} wrap="wrap">
            {url && !visit?.aiConversation && <Button label="Reopen page" size="sm" href={url.href} target="_blank" rel="noopener noreferrer" />}
            {visit && onMove && <Button label="Move page" size="sm" variant="ghost" onClick={() => onMove(visit)} />}
          </HStack>
        </>
      )}
    </VStack>
  );
}
