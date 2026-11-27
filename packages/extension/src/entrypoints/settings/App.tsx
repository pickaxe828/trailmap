import { Heading } from '@astryxdesign/core/Heading';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useState, type ReactNode } from 'react';
import { AI_MODE_STATS_ID } from '../../capture/ai-mode-stats';
import { CHAT_SITE_IDS, CHAT_SITES, chatConversationSite, type ChatSite } from '../../capture/chat-sites';
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
import { ReviewSettingsPanel } from '../../review/ReviewSettingsPanel';
import { ModelJobs } from './ModelJobs';
import { ThreadMatching } from './ThreadMatching';
import { SentToModelLog } from './SentToModelLog';

const sections = [
  ['privacy', 'Privacy'], ['companion', 'Companion'], ['model-providers', 'Model providers'],
  ['review', 'Review'], ['obsidian', 'Obsidian sync'], ['history-import', 'History import'], ['exports', 'Exports'],
  ['sent-to-model', 'Sent-to-model log'], ['diagnostics', 'Diagnostics'],
] as const;

type Section = typeof sections[number][0];

function sectionFromUrl(): Section {
  return sections.find(([id]) => `#${id}` === location.hash)?.[0] ?? 'privacy';
}

async function readCaptureDiagnostics(db: TrailmapDb) {
  return db.transaction('r', db.aiModeStats, db.pages, async () => {
    const aiMode = await db.aiModeStats.get(AI_MODE_STATS_ID) ?? { successes: 0, failures: 0 };
    const chatFailures = Object.fromEntries(CHAT_SITE_IDS.map((site) => [site, 0])) as Record<ChatSite, number>;
    await db.pages.each(({ aiTurns, canonicalUrl }) => {
      if (!aiTurns) return;
      const site = chatConversationSite(canonicalUrl);
      if (site) chatFailures[site] += aiTurns.filter(({ extractionFailed }) => extractionFailed).length;
    });
    return { aiMode, chatFailures };
  });
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
  const diagnostics = useJournalData(readCaptureDiagnostics);
  const missing = diagnostics?.error ? 'Unavailable' : 'Loading…';
  return (
    <VStack as="section" id="diagnostics" gap={2}>
      <Heading level={2}>Diagnostics</Heading>
      <Text as="p">AI Mode reply extraction successes: {diagnostics?.data?.aiMode.successes ?? missing}</Text>
      <Text as="p">AI Mode reply extraction failures: {diagnostics?.data?.aiMode.failures ?? missing}</Text>
      <Text as="p" type="supporting">AI Mode totals stay on this device, even when you forget a conversation. Upgrades start with still-saved turns.</Text>
      {CHAT_SITE_IDS.map((site) => (
        <Text as="p" key={site}>{CHAT_SITES[site].label} reply extraction failures: {diagnostics?.data?.chatFailures[site] ?? missing}</Text>
      ))}
      <Text as="p" type="supporting">Chat counts include only saved questions whose replies could not be captured.</Text>
      {isFirefox && <LocalEmbeddingsNotice />}
      <ModelJobs />
      <ThreadMatching />
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
    review: <ReviewSettingsPanel />,
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
