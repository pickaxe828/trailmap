import { Heading } from '@astryxdesign/core/Heading';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState, type ReactNode } from 'react';
import { CompanionSetup } from '../../companion/CompanionSetup';
import { useCompanionStatus } from '../../companion/useCompanionStatus';
import { ProviderSettings } from '../../llm/ProviderSettings';
import { LOCAL_EMBEDDINGS_UNAVAILABLE } from '../../embeddings/messages';
import { isFirefox } from '../../platform/browser';
import { PrivacySettings } from '../../privacy/PrivacySettings';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { HistoryImportSettings } from '../../ui/HistoryImportSettings';
import { TrailmapShell } from '../../ui/TrailmapShell';
import { ExportSettings } from '../../vault/ExportSettings';
import { VaultSettings } from '../../vault/VaultSettings';
import { ModelJobs } from './ModelJobs';
import { SentToModelLog } from './SentToModelLog';

const sections = [
  ['privacy', 'Privacy'], ['companion', 'Companion'], ['model-providers', 'Model providers'],
  ['obsidian', 'Obsidian sync'], ['history-import', 'History import'], ['exports', 'Exports'],
  ['sent-to-model', 'Sent-to-model log'], ['diagnostics', 'Diagnostics'],
] as const;

type Section = typeof sections[number][0];

function sectionFromUrl(): Section {
  return sections.find(([id]) => `#${id}` === location.hash)?.[0] ?? 'privacy';
}

async function readExtractionFailures(db: TrailmapDb) {
  let count = 0;
  await db.pages.each((page) => { count += page.aiTurns?.filter(({ extractionFailed }) => extractionFailed).length ?? 0; });
  return count;
}

function LocalEmbeddingsNotice() {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let mounted = true;
    const changed: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'session' && LOCAL_EMBEDDINGS_UNAVAILABLE in changes) {
        setUnavailable(changes[LOCAL_EMBEDDINGS_UNAVAILABLE]?.newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.session.get(LOCAL_EMBEDDINGS_UNAVAILABLE).then((stored) => {
      if (mounted) setUnavailable(stored[LOCAL_EMBEDDINGS_UNAVAILABLE] === true);
    }).catch(() => {});
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  return unavailable ? (
    <Text as="p" role="status">Local embeddings could not run. Trailmap can still record Visits and search by keyword.</Text>
  ) : null;
}

function CaptureDiagnostics() {
  const failures = useJournalData(readExtractionFailures);
  return (
    <VStack as="section" id="diagnostics" gap={2}>
      <Heading level={2}>Diagnostics</Heading>
      <Text as="p">AI Mode reply extraction failures: {failures?.data ?? (failures?.error ? 'Unavailable' : 'Loading…')}</Text>
      <Text as="p" type="supporting">Counts saved AI Mode questions whose replies could not be captured.</Text>
      {isFirefox && <LocalEmbeddingsNotice />}
      <ModelJobs />
    </VStack>
  );
}

export function App() {
  const companion = useCompanionStatus();
  const [section, setSection] = useState(sectionFromUrl);
  useEffect(() => {
    const syncSection = () => setSection(sectionFromUrl());
    window.addEventListener('hashchange', syncSection);
    return () => window.removeEventListener('hashchange', syncSection);
  }, []);

  function selectSection(value: string) {
    const next = sections.find(([id]) => id === value)?.[0];
    if (!next || next === section) return;
    history.pushState(null, '', `#${next}`);
    setSection(next);
  }

  const panels = {
    privacy: <PrivacySettings />,
    companion: (
      <VStack as="section" id="companion" gap={2}>
        <Heading level={2}>Set up the companion</Heading>
        <CompanionSetup companion={companion} />
      </VStack>
    ),
    'model-providers': <ProviderSettings companion={companion} />,
    obsidian: <VaultSettings companion={companion} headingLevel={2} />,
    'history-import': <HistoryImportSettings />,
    exports: <ExportSettings />,
    'sent-to-model': <SentToModelLog />,
    diagnostics: <CaptureDiagnostics />,
  } satisfies Record<Section, ReactNode>;

  return (
    <TrailmapShell title="Settings" section="settings"
      description="Manage recording, AI notes, sync, and exports.">
      <TabList role="tablist" aria-label="Settings sections" size="sm" hasDivider value={section} onChange={selectSection}>
        {sections.map(([id, label]) => <Tab key={id} value={id} label={label} panelId={`panel-${id}`} />)}
      </TabList>
      {sections.map(([id, label]) => (
        <VStack as="section" key={id} id={`panel-${id}`} role="tabpanel" aria-label={label}
          tabIndex={id === section ? 0 : undefined} className={id === section ? undefined : 'hidden'}>
          {id === section && panels[id]}
        </VStack>
      ))}
    </TrailmapShell>
  );
}
