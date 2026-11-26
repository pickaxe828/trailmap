import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { VaultFolder } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import { CompanionRequestError, type CompanionStatus } from '../companion/client';
import { setVaultFolder, VAULT_FOLDER_KEY, VAULT_SYNC_KEY, type VaultSyncStatus } from './settings';

export function VaultSettings({ companion, headingLevel = 3 }: { companion: CompanionStatus; headingLevel?: 2 | 3 }) {
  const [folder, setFolder] = useState<VaultFolder | null>();
  const [sync, setSync] = useState<VaultSyncStatus>();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const readFolder = (value: unknown) => {
      const parsed = VaultFolder.safeParse(value);
      setFolder(parsed.success ? parsed.data : null);
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[VAULT_FOLDER_KEY]) readFolder(changes[VAULT_FOLDER_KEY].newValue);
      if (area === 'session' && changes[VAULT_SYNC_KEY]) setSync(changes[VAULT_SYNC_KEY].newValue as VaultSyncStatus);
    };
    chrome.storage.onChanged.addListener(onChanged);
    void chrome.storage.local.get(VAULT_FOLDER_KEY).then((data) => readFolder(data[VAULT_FOLDER_KEY]));
    void chrome.storage.session.get(VAULT_SYNC_KEY).then((data) => setSync(data[VAULT_SYNC_KEY] as VaultSyncStatus | undefined));
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const connected = companion.state === 'connected';
  const currentSync = sync?.folderId === folder?.id ? sync : undefined;
  const status = !connected ? 'Obsidian sync is waiting for the companion.'
    : folder === undefined ? 'Checking Obsidian settings…'
    : !folder ? 'Choose a folder to start syncing.'
    : currentSync?.state === 'error' ? currentSync.message
    : currentSync?.state === 'synced' ? 'Obsidian sync is up to date.' : 'Syncing Obsidian notes…';

  async function select(value?: string | null) {
    if (!connected || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await setVaultFolder(value);
      if (!result.cancelled) setPath('');
    } catch (reason) {
      setError(reason instanceof CompanionRequestError && reason.code === 'unknown_message'
        ? 'Update the companion to use Obsidian sync.'
        : reason instanceof CompanionRequestError ? reason.message : 'Could not save the vault folder.');
    } finally {
      setBusy(false);
    }
  }

  const enterPath = () => { if (path.trim()) void select(path.trim()); };
  return (
    <VStack as="section" id="obsidian" gap={2} aria-label="Obsidian sync">
      <Heading level={headingLevel}>Obsidian sync</Heading>
      <Text type="supporting">Keep a Markdown copy of each Expedition and visible Concept in your vault. Edits in Obsidian do not update Trailmap.</Text>
      <Text role="status">{status}</Text>
      {folder && <Text type="supporting">Vault: {folder.path}</Text>}
      <TextInput label="Obsidian vault folder path" description="Enter the full path to an existing folder."
        value={path} onChange={setPath} onEnter={enterPath} isDisabled={!connected || busy} autoComplete="off" />
      <HStack gap={2} wrap="wrap">
        <Button label="Save vault folder" isDisabled={!connected || busy || !path.trim()} onClick={enterPath} />
        {navigator.platform.startsWith('Mac') && (
          <Button label="Choose folder…" isDisabled={!connected || busy} onClick={() => void select()} />
        )}
        {folder && <Button variant="ghost" label="Stop syncing" isDisabled={!connected || busy} onClick={() => void select(null)} />}
      </HStack>
      {error && <Text role="alert">{error}</Text>}
    </VStack>
  );
}
