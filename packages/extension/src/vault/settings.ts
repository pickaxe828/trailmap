import type { VaultFolder } from '@trailmap/shared';
import { requestCompanion } from '../companion/relay';

export const VAULT_FOLDER_KEY = 'trailmap.vaultFolder';
export const VAULT_SYNC_KEY = 'trailmap.vaultSync';
export type VaultSyncStatus = { folderId: string; state: 'syncing' | 'synced' | 'error'; message?: string };

/** Omit the path for the native picker; pass null to stop syncing. Used by both onboarding and settings. */
export async function setVaultFolder(path?: string | null): Promise<{ folder: VaultFolder | null; cancelled?: true }> {
  return requestCompanion('vault.setFolder', path === undefined ? {} : { path });
}
