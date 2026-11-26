import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { ANTHROPIC_DEFAULT_MODELS, LLM_PROVIDER_NAMES, LlmProviderId, type LlmTaskGroup } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import type { CompanionStatus, ResponseFor } from '../companion/client';
import { onCompanionEvent, requestCompanion } from '../companion/relay';
import { ChatGptConnection } from '../ui/ChatGptConnection';
import { onModelRoutesChanged, readModelRoutes, saveModelRoute, type ModelRoutes } from './settings';

type Catalog = ResponseFor<'llm.models'>;

function statusText(catalog: Catalog, provider: LlmProviderId, keySet: boolean | undefined) {
  const status = catalog.providers?.find((entry) => entry.provider === provider);
  if (provider === 'anthropic' && keySet === false) return 'No key saved';
  switch (status?.error) {
    case 'not_signed_in': return 'Not signed in';
    case 'plan_usage_not_granted': return 'Plan usage off';
    case 'not_eligible': return 'Account not eligible';
    case 'invalid_api_key': return keySet ? 'Key saved · not accepted' : 'API key not available';
    case 'provider_rate_limited': return 'Rate limited · try again later';
    case 'provider_quota_exceeded': return 'Check billing or spend limits';
    case 'provider_unreachable': return 'Not reachable';
    case 'usage_limit_exceeded': return 'Plan usage limit reached';
    case undefined:
      if (status) return catalog.models.some((model) => 'provider' in model && model.provider === provider)
        ? (provider === 'anthropic' ? 'Connected · key saved' : 'Connected')
        : 'Connected · no models available';
      return 'Unavailable';
    default: return 'Unavailable';
  }
}

/** Standalone Settings section; credentials are only held in the input until sent to the companion. */
export function ProviderSettings({ companion }: { companion: CompanionStatus }) {
  const connected = companion.state === 'connected';
  const [catalog, setCatalog] = useState<Catalog>();
  const [key, setKey] = useState('');
  const [keySet, setKeySet] = useState<boolean>();
  const [routes, setRoutes] = useState<ModelRoutes>();
  const [version, refresh] = useState(0);
  const [error, setError] = useState<string>();
  const [catalogError, setCatalogError] = useState<string>();

  useEffect(() => {
    let revision = 0;
    const read = () => {
      const request = ++revision;
      void readModelRoutes().then(
        (routes) => { if (revision === request) setRoutes(routes); },
        () => { if (revision === request) setError('Could not read the saved model choices.'); },
      );
    };
    const stop = onModelRoutesChanged(read);
    read();
    return () => { revision++; stop(); };
  }, []);

  useEffect(() => onCompanionEvent(({ name }) => {
    if (name === 'auth.changed' || name === 'auth.completed') refresh((n) => n + 1);
  }), []);

  useEffect(() => {
    let current = true;
    setCatalog(undefined);
    setCatalogError(undefined);
    setKeySet(undefined);
    if (connected) {
      void requestCompanion('keys.status', { provider: 'anthropic' }).then(
        ({ keySet }) => { if (current) setKeySet(keySet); },
        () => {}, // An unavailable secret store must not hide the other provider catalogs.
      );
      void requestCompanion('llm.models', {}).then(
        (result) => {
          if (!current) return;
          if (result.providers) setCatalog(result);
          else setCatalogError('Update the companion to use model provider settings.');
        },
        () => { if (current) setCatalogError('Could not check model providers. Refresh or update the companion.'); },
      );
    } else {
      setKey('');
    }
    return () => { current = false; };
  }, [connected, version]);

  async function saveKey() {
    setError(undefined);
    setKey('');
    try {
      await requestCompanion('keys.set', { provider: 'anthropic', key });
      refresh((n) => n + 1);
    } catch {
      setError('Could not save the Anthropic API key. Check the key and the companion connection.');
    }
  }

  function modelsFor(provider: LlmProviderId) {
    return (catalog?.models ?? []).flatMap((model) => 'provider' in model && model.provider === provider
      ? [{ value: model.slug, label: model.displayName }] : []);
  }

  function taskFields(group: LlmTaskGroup, title: string) {
    if (!routes) return null;
    const route = routes[group];
    const models = modelsFor(route.provider);
    const choices = LlmProviderId.options.map((provider) => ({ value: provider, label: LLM_PROVIDER_NAMES[provider],
      disabled: provider !== 'chatgpt' && provider !== route.provider && modelsFor(provider).length === 0 }));
    const missing = route.model && !models.some(({ value }) => value === route.model) ? route.model : undefined;
    const automatic = { value: '', label: 'Automatic (provider default)' };
    const save = (provider: LlmProviderId, model?: string) => {
      setError(undefined);
      void saveModelRoute(group, { provider, model }).catch(() => setError('Could not save the model choice.'));
    };
    return (
      <VStack gap={1}>
        <Heading level={3}>{title}</Heading>
        <Selector label={`${title} provider`} options={choices} value={route.provider} onChange={(value) => {
          const provider = LlmProviderId.parse(value);
          const available = modelsFor(provider);
          const preferred = provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODELS[group] : undefined;
          save(provider, available.find(({ value }) => value === preferred)?.value ?? available[0]?.value);
        }} />
        <Selector label={`${title} model`} value={route.model ?? ''} hasSearch={models.length > 8}
          options={[automatic, ...(missing ? [{ value: missing, label: `${missing} (unavailable)`, disabled: true }] : []), ...models]}
          onChange={(model) => save(route.provider, model || undefined)} />
      </VStack>
    );
  }

  return (
    <VStack as="section" id="model-providers" gap={3}>
      <Heading level={2}>Model providers</Heading>
      <Text type="supporting" as="p">Eligible browsing text goes to the chosen provider. Ollama runs locally. Use separate models for Page extraction and for notes and merge decisions.</Text>
      {!connected && <Text role="status">Connect the companion to set up model providers.</Text>}
      {connected && (
        <VStack gap={2} hAlign="start">
          <ChatGptConnection />
          {catalog && LlmProviderId.options.map((provider) => (
            <Text as="p" key={provider}>{LLM_PROVIDER_NAMES[provider]}: {statusText(catalog, provider, keySet)}</Text>
          ))}
          {catalog?.providers?.find(({ provider, error }) => provider === 'ollama' && error === 'provider_unreachable') && (
            <Text type="supporting">Start Ollama on this computer, install a local model, then refresh providers.</Text>
          )}
          {!catalog && !catalogError && <Text role="status">Checking model providers…</Text>}
          {catalogError && <Text role="alert">{catalogError}</Text>}
          {(keySet !== undefined || catalog) && (
            <TextInput label="Anthropic API key" type="password" autoComplete="off" hasSpellCheck={false}
              value={key} onChange={setKey} width="100%" />
          )}
          <HStack gap={2} wrap="wrap">
            {(keySet !== undefined || catalog) && <Button label="Save API key" clickAction={saveKey} isDisabled={!key.trim()} />}
            <Button label="Refresh providers" variant="ghost" onClick={() => refresh((n) => n + 1)} />
          </HStack>
        </VStack>
      )}
      {connected && catalog && taskFields('extraction', 'Extraction')}
      {connected && catalog && taskFields('notes', 'Notes')}
      {error && <Text role="alert">{error}</Text>}
    </VStack>
  );
}
