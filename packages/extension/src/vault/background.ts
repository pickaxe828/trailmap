import { VaultFolder } from '@trailmap/shared';
import { liveQuery, type Subscription } from 'dexie';
import { getCompanionClient } from '../companion/background';
import { CompanionRequestError } from '../companion/client';
import type { TrailmapDb } from '../db/db';
import { readMarkdownNotes } from './data';
import { sha256, type MarkdownNote } from './notes';
import { VAULT_FOLDER_KEY, VAULT_SYNC_KEY, type VaultSyncStatus } from './settings';

const RETRY_ALARM = 'trailmap.vault.retry';

/** The ledger stores hashes, not browsing data. Keep both possible hashes across a worker/host loss during a write. */
type Ledger = Record<string, { hashes: string[]; synced: boolean }>;

export function startVaultSync(db: TrailmapDb): void {
  const client = getCompanionClient();
  let subscription: Subscription | undefined;
  let folderId: string | undefined;
  let epoch = 0;
  let pending: { id: string; epoch: number; notes: MarkdownNote[] } | undefined;
  let running = false;

  async function publish(status: VaultSyncStatus) {
    await chrome.storage.session.set({ [VAULT_SYNC_KEY]: status });
  }

  async function failed(id: string, error: unknown) {
    if (folderId !== id) return;
    const message = error instanceof CompanionRequestError && error.code === 'unknown_message'
      ? 'Update the companion to use Obsidian sync.'
      : error instanceof CompanionRequestError ? error.message : 'Could not sync Obsidian notes. Trailmap will retry.';
    await publish({ folderId: id, state: 'error', message });
    await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
  }

  async function reconcile(id: string, notes: MarkdownNote[], current: () => boolean) {
    const key = `trailmap.vaultLedger.${id}`;
    const ledger = (await chrome.storage.local.get(key))[key] as Ledger | undefined ?? {};
    const paths = new Set(notes.map(({ path }) => path));
    const stale = Object.keys(ledger).filter((path) => !paths.has(path));
    const hashed = await Promise.all(notes.map(async (note) => ({ ...note, hash: await sha256(note.markdown) })));
    const changes = hashed.filter(({ path, hash }) => !ledger[path]?.synced || ledger[path]?.hashes[0] !== hash);
    if (!current()) return;

    if (changes.length || stale.length) {
      await publish({ folderId: id, state: 'syncing' });
      for (const { path, hash } of changes) {
        ledger[path] = { synced: false, hashes: [...new Set([...(ledger[path]?.hashes ?? []), hash])] };
      }
      // Persist intent before issuing writes so Forget can still prune a file if the worker dies before the reply.
      await chrome.storage.local.set({ [key]: ledger });
      const operations = [
        ...changes.map(({ path, hash, markdown }) => async () => {
          await client.request('vault.write', { folderId: id, path, markdown });
          ledger[path] = { synced: true, hashes: [hash] };
        }),
        ...stale.map((path) => async () => {
          for (const hash of ledger[path]?.hashes ?? []) {
            await client.request('vault.remove', { folderId: id, path, sha256: hash });
          }
          delete ledger[path];
        }),
      ];
      const errors: unknown[] = [];
      for (let i = 0; i < operations.length && current(); i += 8) {
        const results = await Promise.allSettled(operations.slice(i, i + 8).map((run) => run()));
        for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
      }
      await chrome.storage.local.set({ [key]: ledger });
      if (errors.length) throw errors[0];
    }
    if (current()) {
      await publish({ folderId: id, state: 'synced' });
      await chrome.alarms.clear(RETRY_ALARM);
    }
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const item = pending;
        pending = undefined;
        const current = () => item.epoch === epoch && client.status.state === 'connected';
        try {
          if (current()) await reconcile(item.id, item.notes, current);
        } catch (error) {
          if (current()) await failed(item.id, error);
        }
      }
    } finally {
      running = false;
    }
  }

  async function refresh(force = false) {
    const stored = await chrome.storage.local.get(VAULT_FOLDER_KEY);
    const folder = VaultFolder.safeParse(stored[VAULT_FOLDER_KEY]);
    const next = folder.success && client.status.state === 'connected' ? folder.data.id : undefined;
    if (!force && next === folderId) return;
    subscription?.unsubscribe();
    pending = undefined;
    folderId = next;
    const version = ++epoch;
    if (!next) return;
    subscription = liveQuery(() => readMarkdownNotes(db)).subscribe({
      next: (notes) => {
        pending = { id: next, epoch: version, notes };
        void drain().catch(() => {});
      },
      error: (error) => void failed(next, error).catch(() => {}),
    });
  }

  const observe = (force = false) => void refresh(force).catch(() => {});
  client.subscribe(() => observe());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[VAULT_FOLDER_KEY]) observe(true);
  });
  chrome.alarms.onAlarm.addListener(({ name }) => { if (name === RETRY_ALARM) observe(true); });
  observe();
}
