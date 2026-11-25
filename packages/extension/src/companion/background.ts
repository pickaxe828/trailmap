/**
 * Background wiring for the companion client. Later tickets import `getCompanionClient()` to make requests:
 *
 *   const reply = await getCompanionClient().request('companion.hello', {});
 *
 * Status is mirrored into `chrome.storage.session` so the side panel (a separate context) can show it live.
 */
import { CompanionClient } from './client';
import { chromeTransport } from './chrome-transport';
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

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null && 'type' in message && message.type === COMPANION_RECONNECT_MESSAGE) {
      companion.reconnectNow();
    }
  });

  companion.start();
}
