import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { generateDigest, type DigestReply } from '../../digest/messages';
import type { DigestView } from '../../digest/read';
import { digestTitle } from '../../digest/title';
import { expeditionHref, formatExpeditionDate, threadHref } from '../../journal/links';

const NOTHING = 'Nothing from the last 7 days can be sent to a model, so there is nothing to write.';

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <VStack gap={1}>
      <Text type="label">{heading}</Text>
      <VStack as="ul" gap={1} className="list-none p-0 m-0">{children}</VStack>
    </VStack>
  );
}

function Digest({ digest }: { digest: DigestView }) {
  const title = digestTitle(digest);
  return (
    <VStack as="article" aria-label={title} gap={3}>
      <VStack gap={0}>
        <Heading level={3}>{title}</Heading>
        <Text type="supporting">Written {formatExpeditionDate(digest.generatedAt)}</Text>
      </VStack>
      <Text as="p">{digest.summary}</Text>
      {digest.expeditions.length > 0 && (
        <Group heading="Top expeditions">
          {digest.expeditions.map(({ id, title, why }) => (
            <li key={id}><Link href={expeditionHref(id)} isStandalone hasUnderline>{title}</Link>{why && <Text type="supporting"> — {why}</Text>}</li>
          ))}
        </Group>
      )}
      {digest.threads.length > 0 && (
        <Group heading="Top threads">
          {digest.threads.map(({ id, title, why }) => (
            <li key={id}><Link href={threadHref(id)} isStandalone hasUnderline>{title}</Link>{why && <Text type="supporting"> — {why}</Text>}</li>
          ))}
        </Group>
      )}
      {digest.concepts.length > 0 && (
        <Group heading="New concepts">
          {digest.concepts.map(({ id, name, strength }) => (
            <li key={id}><Link href={`${chrome.runtime.getURL('/atlas.html')}?${new URLSearchParams({ concept: id })}`} isStandalone hasUnderline>{name}</Link>
              <Text type="supporting"> — {strength}</Text></li>
          ))}
        </Group>
      )}
      {digest.looseEnds.length > 0 && (
        <Group heading="Open loose ends">
          {digest.looseEnds.map(({ expeditionId, expeditionTitle, text, href }, i) => (
            <li key={`${expeditionId}:${i}`}>
              {href ? <Link href={href} isStandalone hasUnderline isExternalLink>{text}</Link> : <Text>{text}</Text>}
              <Text type="supporting"> in </Text><Link href={expeditionHref(expeditionId)} isStandalone hasUnderline>{expeditionTitle}</Link>
            </li>
          ))}
        </Group>
      )}
      {digest.pickingUp.length > 0 && (
        <Group heading="Pick up again">
          {digest.pickingUp.map(({ id, title }) => <li key={id}><Link href={threadHref(id)} isStandalone hasUnderline>{title}</Link></li>)}
        </Group>
      )}
    </VStack>
  );
}

/** Weekly digests, newest first, and the command to write one for the last 7 days. */
export function DigestSection({ digests, working }: { digests: DigestView[]; working: boolean }) {
  const [reply, setReply] = useState<DigestReply>();
  const [asking, setAsking] = useState(false);
  async function generate() {
    setAsking(true);
    setReply(await generateDigest().catch((): DigestReply => ({ status: 'nothing' })));
    setAsking(false);
  }
  const [latest, ...earlier] = digests;
  return (
    <VStack as="section" aria-labelledby="digests-heading" gap={3}>
      <HStack justify="between" align="center" gap={2} wrap="wrap">
        <Heading level={2} id="digests-heading">Weekly digest</Heading>
        <Button label="Generate this week's digest" size="sm" variant="secondary" isLoading={asking || working} isDisabled={asking || working} onClick={() => void generate()} />
      </HStack>
      <Text type="supporting">Written every Monday from your field notes and living notes, never from page text. One model call, listed in Sent to model.</Text>
      <VStack aria-live="polite">
        {working && <Text role="status" type="supporting">Writing your digest…</Text>}
        {reply?.status === 'nothing' && !working && <Text role="status">{NOTHING}</Text>}
        {reply?.status === 'paused' && <Text role="status">Recording is paused, so no digest was written.</Text>}
      </VStack>
      {!latest && !working && <Text>Your first digest appears on Monday, or generate one now.</Text>}
      {latest && <Digest digest={latest} />}
      {earlier.length > 0 && (
        <Collapsible defaultIsOpen={false} trigger={<Heading level={3}>Earlier digests ({earlier.length})</Heading>}>
          <VStack gap={5}>{earlier.map((digest) => <Digest key={digest.id} digest={digest} />)}</VStack>
        </Collapsible>
      )}
    </VStack>
  );
}
