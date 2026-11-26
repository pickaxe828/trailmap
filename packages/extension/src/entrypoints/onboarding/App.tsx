import { Code } from '@astryxdesign/core/Code';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useCompanionStatus } from '../../companion/useCompanionStatus';
import { ProviderSettings } from '../../llm/ProviderSettings';
import { ChatGptConnection } from '../../ui/ChatGptConnection';
import { SentToModelLog } from './SentToModelLog';
import { ExportSettings } from '../../vault/ExportSettings';
import { VaultSettings } from '../../vault/VaultSettings';

/** Onboarding tab, opened on first install. Placeholder: later tickets add the privacy screen. */
export function App() {
  const companion = useCompanionStatus();
  return (
    <VStack gap={3} padding={8} maxWidth={640}>
      <Heading level={1}>Welcome to Trailmap</Heading>
      <Text>
        Trailmap quietly turns your learning-oriented browsing into trails, field notes and a concept graph.
        Recording starts straight away.
      </Text>
      <VStack gap={2} id="companion">
        <Heading level={2}>Set up the companion</Heading>
        <Text>
          The companion is a small program on your computer. AI notes (ChatGPT sign-in, Anthropic, Ollama) and
          Obsidian sync need it; recording and trails work without it.
        </Text>
        <Text>
          1. Build it: <Code>bun run build:companion</Code>
        </Text>
        <Text>
          2. Register it with your browsers: <Code>packages/companion/dist/trailmap-companion install</Code>
        </Text>
        <Text>
          3. Reopen the Trailmap side panel. It should say "Companion connected".
        </Text>
        <Text type="supporting">
          <Code>trailmap-companion uninstall</Code> removes the registration again.
        </Text>
      </VStack>
      {companion.state === 'connected' && <ChatGptConnection />}
      <VStack gap={3} id="settings">
        <Heading level={2}>Settings</Heading>
        <ProviderSettings />
        <VaultSettings companion={companion} />
        <ExportSettings />
        <SentToModelLog />
      </VStack>
    </VStack>
  );
}
