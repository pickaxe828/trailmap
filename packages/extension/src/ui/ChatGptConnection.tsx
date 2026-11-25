import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { ChatGptStatus } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import { CompanionRequestError } from '../companion/client';
import { onCompanionEvent, requestCompanion } from '../companion/relay';

export function ChatGptConnection() {
  const [status, setStatus] = useState<ChatGptStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let revision = 0;
    const readStatus = () => {
      const request = ++revision;
      void requestCompanion('auth.status', {}).then(
        (status) => { if (request === revision) setStatus(status); },
        () => { if (request === revision) setError('Could not check ChatGPT sign-in.'); },
      );
    };
    const unsubscribe = onCompanionEvent((event) => {
      if (event.name === 'auth.failed') setError(event.message);
      if (event.name === 'auth.completed') setError(undefined);
      if (event.name === 'auth.changed' || event.name === 'auth.completed' || event.name === 'auth.failed') readStatus();
    });
    readStatus();
    return () => {
      revision += 1;
      unsubscribe();
    };
  }, []);

  async function signIn() {
    setError(undefined);
    try {
      const response = await requestCompanion('auth.signIn', {});
      const url = new URL(response.url);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
        throw new Error('Unexpected authorization URL');
      }
      await chrome.tabs.create({ url: url.href });
    } catch (error) {
      setError(error instanceof CompanionRequestError ? error.message : 'Could not open ChatGPT sign-in.');
    }
  }

  async function signOut() {
    setError(undefined);
    try {
      const result = await requestCompanion('auth.signOut', {});
      if (!result.revocationConfirmed) {
        setError('Signed out in Trailmap. To disconnect the remote session, use ChatGPT Settings.');
      }
    } catch (error) {
      setError(error instanceof CompanionRequestError ? error.message : 'Could not sign out of ChatGPT.');
    }
  }

  const identity = status?.email ? 'Signed in as ' + status.email : 'Signed in to ChatGPT';
  return (
    <VStack gap={2} hAlign="start">
      {status?.signedIn && <Text role="status">{identity} · plan usage {status.planUsage ? 'on' : 'off'}</Text>}
      {status && !status.planUsage && (
        <Button
          label="Continue with ChatGPT"
          variant="primary"
          size="sm"
          clickAction={signIn}
          isLoading={status.signingIn}
        />
      )}
      {status?.signedIn && <Button label="Sign out" variant="ghost" size="sm" clickAction={signOut} />}
      {status?.signingIn && <Text role="status" type="supporting">Finish signing in in the ChatGPT tab.</Text>}
      {error && <Text role="alert" type="supporting">{error}</Text>}
    </VStack>
  );
}
