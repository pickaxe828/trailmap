import { Heading } from '@astryxdesign/core/Heading';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { CHAT_SITE_IDS, CHAT_SITES, type ChatCaptureSettings as ChatCapture, type ChatSite } from '../capture/chat-sites';
import { RECORDING_MESSAGE, type RecordingRequest } from './messages';

/** Per-site opt-in for conversation capture. Every site is off until the user turns it on. */
export function ChatCaptureSettings({ value }: { value: ChatCapture | undefined }) {
  const [error, setError] = useState(false);

  async function save(site: ChatSite, enabled: boolean) {
    setError(false);
    try {
      if (!await chrome.runtime.sendMessage({ type: RECORDING_MESSAGE, action: 'set-chat-capture', site, enabled } satisfies RecordingRequest)) throw new Error();
    } catch {
      setError(true);
    }
  }

  return (
    <VStack as="section" aria-labelledby="chat-capture-title" gap={2}>
      <Heading level={3} id="chat-capture-title">Chat conversations</Heading>
      <Text as="p" type="supporting">
        Chat sites are on the default skip list because chats can be personal. Turn a site on to keep the questions you type there and
        the replies to them as an AI conversation. The chat page itself is still not recorded, history already on the page is never
        captured, and nothing is read before you turn the site on. Turning a site off stops capture and removes the conversations
        already captured from it.
      </Text>
      {CHAT_SITE_IDS.map((site) => (
        <Switch key={site} size="sm" label={`Capture conversations from ${CHAT_SITES[site].label}`} value={value?.[site] === true}
          isDisabled={value === undefined} description={CHAT_SITES[site].host} changeAction={(enabled) => save(site, enabled)} />
      ))}
      {error && <Text role="alert">Could not save the chat capture setting.</Text>}
    </VStack>
  );
}
