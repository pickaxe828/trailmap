/**
 * Background wiring for the companion client. Later tickets import `getCompanionClient()` to make requests:
 *
 *   const reply = await getCompanionClient().request('companion.hello', {});
 *
 * Status is mirrored into `chrome.storage.session` so the side panel (a separate context) can show it live.
 */
import { CompanionRequest } from '@trailmap/shared';
import { CompanionClient, CompanionRequestError } from './client';
import { chromeTransport } from './chrome-transport';
import { COMPANION_EVENT, COMPANION_RELAY } from './relay';
import { COMPANION_RECONNECT_MESSAGE, COMPANION_STATUS_KEY } from './status';
import { VAULT_FOLDER_KEY } from '../vault/settings';

const KEEPALIVE_ALARM = 'trailmap.companion.retry';

let client: CompanionClient | null = null;

export function getCompanionClient(): CompanionClient {
  client ??= new CompanionClient({ transport: chromeTransport });
  return client;
}

/** Call once, synchronously, from the background's top level so listeners exist before any event arrives. */
export function startCompanion(): void {
  const companion = getCompanionClient();
  companion.subscribe((status) => void chrome.storage.session.set({ [COMPANION_STATUS_KEY]: status }));

  // The service worker sleeps when idle and dies on crashes, so timers alone cannot keep retrying.
  // The alarm wakes it every 30 s (the minimum) to retry while the companion is missing.
  void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) companion.reconnectNow();
  });

  companion.onEvent((event) => {
    if (event.name === 'llm.dispatch') return; // Contains Page text; handled only by the dispatch guard.
    void chrome.runtime.sendMessage({ type: COMPANION_EVENT, event }).catch(() => {});
  });

  const settingsPages = new Set(['/onboarding.html', '/settings.html'].map((path) => chrome.runtime.getURL(path)));
  const relayPages = new Set([...settingsPages, chrome.runtime.getURL('/sidepanel.html')]);
  let selectingVault = false;
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return;
    if (message.type === COMPANION_RECONNECT_MESSAGE) {
      companion.reconnectNow();
      return;
    }
    if (message.type !== COMPANION_RELAY || sender.id !== chrome.runtime.id || !sender.url) return;
    // Fragments are used for links into onboarding. Web pages and content scripts cannot proxy Native Messaging.
    const page = sender.url.split(/[?#]/, 1)[0]!;
    if (!relayPages.has(page)) return;
    const raw = 'request' in message ? message.request : null;
    const request = CompanionRequest.safeParse(
      typeof raw === 'object' && raw !== null ? { ...raw, id: 'relay' } : raw,
    );
    if (!request.success || request.data.type === 'llm.complete' || request.data.type === 'llm.dispatchAck' ||
      request.data.type === 'vault.write' || request.data.type === 'vault.remove' ||
      (request.data.type === 'vault.setFolder' && !settingsPages.has(page))) {
      respond({ ok: false, code: 'invalid_message', message: 'Malformed companion request.' });
      return;
    }
    const { type, id: _id, ...payload } = request.data;
    if ((type === 'keys.set' || type === 'keys.status') && !settingsPages.has(page)) {
      respond({ ok: false, code: 'invalid_message', message: 'API keys can only be managed from Settings.' });
      return;
    }
    if (type === 'vault.setFolder' && selectingVault) {
      respond({ ok: false, code: 'vault_unavailable', message: 'Finish choosing the vault folder in the other tab.' });
      return;
    }
    async function requestAndSaveFolder(path?: string | null) {
      selectingVault = true;
      try {
        const response = await companion.request('vault.setFolder', { path });
        if (!response.cancelled) await chrome.storage.local.set({ [VAULT_FOLDER_KEY]: response.folder });
        return response;
      } finally {
        selectingVault = false;
      }
    }
    const operation = request.data.type === 'vault.setFolder'
      ? requestAndSaveFolder(request.data.path) : companion.request(type, payload);
    void operation.then(
      (response) => respond({ ok: true, response }),
      (error: unknown) => respond({
        ok: false,
        code: error instanceof CompanionRequestError ? error.code : 'internal',
        message: error instanceof CompanionRequestError ? error.message : 'The companion request failed.',
        details: error instanceof CompanionRequestError ? error.details : undefined,
      }),
    );
    return true;
  });

  companion.start();
}
