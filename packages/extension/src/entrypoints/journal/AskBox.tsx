import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useRef, useState } from 'react';
import { askJournal, MAX_ASK_QUESTION, NOTHING_IN_YOUR_TRAILS, type AskReply } from '../../ask/messages';

const ASK_PARAM = 'ask';

/** Ask a question of your own pages and notes. One model call per question; nothing is kept after you leave the page. */
export function AskBox() {
  const [question, setQuestion] = useState(() => (new URLSearchParams(location.search).get(ASK_PARAM) ?? '').slice(0, MAX_ASK_QUESTION));
  const [asked, setAsked] = useState<string>();
  const [reply, setReply] = useState<AskReply>();
  const [pending, setPending] = useState(false);
  const run = useRef(0);

  async function submit(text = question) {
    const value = text.trim();
    if (!value || pending) return;
    const id = ++run.current;
    setPending(true);
    setAsked(value);
    setReply(undefined);
    const result = await askJournal(value).catch((): AskReply => ({ status: 'error', code: 'internal', message: 'Trailmap could not answer that.' }));
    if (id !== run.current) return;
    setReply(result);
    setPending(false);
  }
  // `tm ?question` opens the Journal with the question already typed; it is the user's own request, so it runs once.
  useEffect(() => { if (question.trim()) void submit(); }, []);

  return (
    <VStack as="section" aria-label="Ask" gap={2}>
      <form className="w-full" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <HStack gap={2} align="end" width="100%">
          <TextInput width="100%" label="Ask your trails" placeholder="Ask a question about what you have read" value={question}
            onChange={(value) => setQuestion(value.slice(0, MAX_ASK_QUESTION))} autoComplete="off" enterKeyHint="send" />
          <Button type="submit" className="shrink-0 whitespace-nowrap" label="Ask" variant="primary" isLoading={pending} isDisabled={!question.trim()} />
        </HStack>
      </form>
      <Text type="supporting">Sends passages from pages you may share with your model provider, once per question. Type “tm ?” in the address bar to ask from there.</Text>
      <VStack aria-live="polite" gap={2}>
        {pending && <Text role="status" type="supporting">Reading your trails…</Text>}
        {reply?.status === 'nothing' && <Text role="status">{NOTHING_IN_YOUR_TRAILS}</Text>}
        {reply?.status === 'error' && <Text role="alert">{reply.message}</Text>}
        {reply?.status === 'answered' && (
          <VStack gap={3}>
            <Heading level={2}>{asked}</Heading>
            <Text as="p">{reply.answer}</Text>
            <List header={<Text type="label">Sources</Text>} hasDividers>
              {reply.citations.map(({ kind, id, title, href }) => (
                <ListItem key={`${kind}:${id}`} label={<Text type="label" color={href ? 'accent' : undefined} maxLines={2} className={href ? 'underline' : undefined}>{title}</Text>}
                  description={<Text type="supporting">{kind === 'page' ? 'Page' : 'Expedition'}</Text>}
                  href={href} target={kind === 'page' ? '_blank' : undefined} />
              ))}
            </List>
          </VStack>
        )}
      </VStack>
    </VStack>
  );
}
