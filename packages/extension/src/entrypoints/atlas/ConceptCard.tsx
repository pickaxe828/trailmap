import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { Concept } from '@trailmap/shared';
import { useCallback } from 'react';
import { readAtlasEvidence } from '../../atlas/data';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { expeditionHref, formatExpeditionDate } from '../../journal/links';
import { webUrl } from '../../ui/web-url';

export function ConceptCard({ concept, neighbours, onFocus, onClose }: {
  concept: Concept; neighbours: readonly Pick<Concept, 'id' | 'name'>[];
  onFocus: (id: string) => void; onClose: () => void;
}) {
  const read = useCallback((db: TrailmapDb) => readAtlasEvidence(db, concept.id), [concept.id]);
  const evidence = useJournalData(read);
  return (
    <VStack as="aside" aria-label="Concept details" className="min-w-0">
      <Card padding={5}>
        <VStack gap={5}>
          <VStack gap={2}>
            <HStack align="center" justify="between" gap={2}>
              <Text type="supporting">Concept details</Text>
              <Button size="sm" label="Close" onClick={onClose} />
            </HStack>
            <Heading level={2} maxLines={2}>{concept.name}</Heading>
            <Text className="wrap-anywhere">{concept.gloss || 'No gloss yet.'}</Text>
            <Text type="supporting">First seen {formatExpeditionDate(concept.firstSeen)}</Text>
          </VStack>
          {!evidence && <Text type="supporting">Looking up evidence…</Text>}
          {evidence?.error && <Text role="alert">Could not load this concept’s evidence.</Text>}
          {evidence?.data && (
            <>
              <Text type="supporting" data-learned={evidence.data.learned ? 'yes' : 'no'}>
                {evidence.data.learned ? 'Learned: it comes from your own notes.'
                  : 'Only seen on pages. Write about it in an expedition’s My notes to make it solid.'}
              </Text>
              <VStack gap={1}>
                <Heading level={3}>Evidence pages</Heading>
                {evidence.data.pages.length ? (
                  <List edge="flush" aria-label="Evidence pages">
                    {evidence.data.pages.map(({ url, title, taught, aiStop }) => {
                      const href = aiStop ? (aiStop.expeditionId ? expeditionHref(aiStop.expeditionId, aiStop.visitId) : undefined)
                        : webUrl(url)?.href;
                      return <Item key={url} as="li" label={<Text maxLines={2} color={href ? 'accent' : 'primary'}
                        className={href ? 'underline' : undefined}>{title}</Text>} density="compact"
                        description={aiStop ? 'AI-generated, not an independent source'
                          : taught ? 'Explains this concept' : 'Mentions or uses this concept'}
                        href={href} target={aiStop ? undefined : '_blank'} />;
                    })}
                  </List>
                ) : <Text type="supporting">No evidence pages remain.</Text>}
              </VStack>
              <VStack gap={1}>
                <Heading level={3}>Expeditions</Heading>
                {evidence.data.expeditions.length ? (
                  <List edge="flush" aria-label="Expeditions">
                    {evidence.data.expeditions.map(({ id, title }) => (
                      <Item key={id} as="li" label={<Text maxLines={2} color="accent" className="underline">{title}</Text>}
                        density="compact" href={expeditionHref(id)} />
                    ))}
                  </List>
                ) : <Text type="supporting">Not part of an expedition yet.</Text>}
              </VStack>
            </>
          )}
          <VStack gap={1}>
            <Heading level={3}>Neighbours</Heading>
            {neighbours.length ? (
              <List edge="flush" aria-label="Neighbours">
                {neighbours.map(({ id, name }) => (
                  <Item key={id} as="li" label={name} labelLines={2} density="compact"
                    endContent={<Icon icon="chevronRight" />} onClick={() => onFocus(id)} />
                ))}
              </List>
            ) : <Text type="supporting">No connected concepts at this date.</Text>}
          </VStack>
        </VStack>
      </Card>
    </VStack>
  );
}
