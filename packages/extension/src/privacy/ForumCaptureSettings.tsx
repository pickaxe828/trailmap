import { Heading } from '@astryxdesign/core/Heading';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useState } from 'react';
import { RECORDING_MESSAGE, type RecordingRequest } from './messages';

/** Opt-in for Reddit thread pages. Off until the user turns it on; Hacker News needs no opt-in. */
export function ForumCaptureSettings({ value }: { value: boolean | undefined }) {
  const [error, setError] = useState(false);

  async function save(enabled: boolean) {
    setError(false);
    try {
      if (!await chrome.runtime.sendMessage({ type: RECORDING_MESSAGE, action: 'set-reddit-threads', enabled } satisfies RecordingRequest)) throw new Error();
    } catch {
      setError(true);
    }
  }

  return (
    <VStack as="section" aria-labelledby="forum-capture-title" gap={2}>
      <Heading level={3} id="forum-capture-title">Forum threads</Heading>
      <Text as="p" type="supporting">
        Reddit is on the default skip list because it is a social feed. Turn this on to keep Reddit thread pages (a post and its first
        comments, without any user names). Feeds, profiles, your inbox and settings stay skipped. Turning it off stops capture and
        removes the Reddit threads already captured. Hacker News items are kept like any other page.
      </Text>
      <Switch size="sm" label="Capture Reddit thread pages" value={value === true} isDisabled={value === undefined}
        description="reddit.com/r/…/comments/…" changeAction={save} />
      {error && <Text role="alert">Could not save the Reddit thread setting.</Text>}
    </VStack>
  );
}
