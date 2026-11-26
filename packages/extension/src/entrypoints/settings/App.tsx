import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect } from 'react';
import { CompanionSetup } from '../../companion/CompanionSetup';
import { useCompanionStatus } from '../../companion/useCompanionStatus';
import { ProviderSettings } from '../../llm/ProviderSettings';
import { PrivacySettings } from '../../privacy/PrivacySettings';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { HistoryImportSettings } from '../../ui/HistoryImportSettings';
import { ExportSettings } from '../../vault/ExportSettings';
import { VaultSettings } from '../../vault/VaultSettings';
import { ModelJobs } from './ModelJobs';
import { SentToModelLog } from './SentToModelLog';

const sections = [
  ['privacy', 'Privacy'], ['companion', 'Companion'], ['model-providers', 'Model providers'],
  ['obsidian', 'Obsidian sync'], ['history-import', 'History import'], ['exports', 'Exports'],
  ['sent-to-model', 'Sent-to-model log'], ['diagnostics', 'Diagnostics'],
];

async function readExtractionFailures(db: TrailmapDb) {
  let count = 0;
  await db.pages.each((page) => { count += page.aiTurns?.filter(({ extractionFailed }) => extractionFailed).length ?? 0; });
  return count;
}

function CaptureDiagnostics() {
  const failures = useJournalData(readExtractionFailures);
  return (
    <VStack as="section" id="diagnostics" gap={2}>
      <Heading level={2}>Diagnostics</Heading>
      <Text as="p">AI Mode reply extraction failures: {failures?.data ?? (failures?.error ? 'Unavailable' : 'Loading…')}</Text>
      <Text as="p" type="supporting">Counts saved AI Mode questions whose replies could not be captured.</Text>
      <ModelJobs />
    </VStack>
  );
}

export function App() {
  const companion = useCompanionStatus();
  useEffect(() => {
    // WXT mounts React after the browser may have tried the initial fragment.
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);

  return (
    <Layout contentWidth="44rem"
      header={(
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={2}>
            <Heading level={1}>Settings</Heading>
            <Text as="p" type="supporting">Manage what Trailmap records and how it writes, syncs, and exports your notes.</Text>
            <HStack as="nav" aria-label="Settings sections" gap={2} wrap="wrap">
              {sections.map(([id, label]) => <Link key={id} href={`#${id}`}>{label}</Link>)}
            </HStack>
          </VStack>
        </LayoutHeader>
      )}
      content={(
        <LayoutContent padding={4} role="main">
          <VStack gap={4}>
            <PrivacySettings />
            <Divider />
            <VStack as="section" id="companion" gap={2}>
              <Heading level={2}>Set up the companion</Heading>
              <CompanionSetup companion={companion} />
            </VStack>
            <Divider />
            <ProviderSettings companion={companion} />
            <Divider />
            <VaultSettings companion={companion} headingLevel={2} />
            <Divider />
            <HistoryImportSettings />
            <Divider />
            <ExportSettings />
            <Divider />
            <SentToModelLog />
            <Divider />
            <CaptureDiagnostics />
          </VStack>
        </LayoutContent>
      )}
    />
  );
}
