import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { PageSummaryReply, SUMMARIZE_PAGE } from '../../llm/page-summary';

export function SummarizePage() {
  const [reply, setReply] = useState<PageSummaryReply>();

  async function summarize() {
    setReply(undefined);
    try {
      const result: unknown = await chrome.runtime.sendMessage(SUMMARIZE_PAGE);
      setReply(PageSummaryReply.parse(result));
    } catch {
      setReply({ ok: false, code: 'internal', message: 'Trailmap could not summarize this page.' });
    }
  }

  return (
    <VStack gap={2} align="start">
      <Button label="Summarize this page" size="sm" clickAction={summarize} />
      <Text type="supporting">Sends this page’s captured text to your extraction provider.</Text>
      <Link hasUnderline isStandalone href="/settings.html#model-providers" target="_blank">Model settings</Link>
      {reply && (
        <section aria-live="polite">
          {reply.ok ? (
            <VStack gap={1}>
              <Heading level={2}>Summary: {reply.title}</Heading>
              <Text as="p">{reply.summary.summary}</Text>
              <Text type="supporting">Sent this page’s captured text to your extraction provider.{' '}
                <Link hasUnderline href="/settings.html#sent-to-model" target="_blank">See what was sent</Link>
              </Text>
              <List listStyle="disc" density="compact" edge="flush" header={<Heading level={3}>Key takeaways</Heading>}>
                {reply.summary.takeaways.map((takeaway, index) => (
                  <ListItem key={index} align="first-line" label={<Text>{takeaway}</Text>} />
                ))}
              </List>
            </VStack>
          ) : (
            <Text>
              {reply.message}{' '}
              {reply.code === 'usage_limit_exceeded' && (
                <Link hasUnderline href="https://chatgpt.com/settings/usage" target="_blank">ChatGPT usage settings</Link>
              )}
            </Text>
          )}
        </section>
      )}
    </VStack>
  );
}
