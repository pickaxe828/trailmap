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
    void chrome.runtime.sendMessage({ type: COMPANION_EVENT, event }).catch(() => {});
  });

  const relayPages = new Set(['/sidepanel.html', '/onboarding.html'].map((path) => chrome.runtime.getURL(path)));
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
    if (!request.success) {
      respond({ ok: false, code: 'invalid_message', message: 'Malformed companion request.' });
      return;
    }
    const { type, id: _id, ...payload } = request.data;
    void companion.request(type, payload).then(
      (response) => respond({ ok: true, response }),
      (error: unknown) => respond({
        ok: false,
        code: error instanceof CompanionRequestError ? error.code : 'internal',
        message: error instanceof CompanionRequestError ? error.message : 'The companion request failed.',
      }),
    );
    return true;
  });

  companion.start();
}
