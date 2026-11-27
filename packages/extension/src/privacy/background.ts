import { CHAT_SITES } from '../capture/chat-sites';
import { RESCREEN_CHAT_MESSAGE } from '../capture/page-messages';
import type { VisitRecorder } from '../capture/recorder';
import { isRecordingRequest, PASSWORD_STATUS_CHANGED, TOGGLE_RECORDING_COMMAND, type RecordingStatus } from './messages';
import { chatCaptureAllowed, recordingState, siteKey, type RecordingSettings, type RecordingState } from './policy';
import { readRecordingSettings, saveRecordingSettings } from './settings';

const badges: Record<RecordingState, { text: string; title: string }> = {
  recording: { text: 'ON', title: 'Trailmap — Recording is on' },
  paused: { text: 'OFF', title: 'Trailmap — Recording paused' },
  skipped: { text: 'SKIP', title: 'Trailmap — Site is skipped' },
};

/** `unseenNotes` is the toolbar count of field notes nobody has looked at yet; it takes the badge over from the recording state. */
export function createRecordingPrivacy(unseenNotes: () => number, purge: (host?: string, settings?: RecordingSettings) => Promise<unknown>) {
  // Start fail-closed until preferences load and any interrupted purge completes.
  let settings: RecordingSettings = { paused: true, skippedHosts: [] };
  const ready = readRecordingSettings().then(async (saved) => {
    // Captured chat conversations survive this deny-list purge only for sites that are still opted in.
    await purge(undefined, saved);
    for (const host of saved.skippedHosts) await purge(host);
    settings = saved;
  });
  let recorder: VisitRecorder;
  let settingsWritten = Promise.resolve();

  function stateFor(tab: chrome.tabs.Tab): RecordingState {
    const state = recordingState(tab.url, settings);
    return state === 'recording' && tab.id !== undefined && recorder.isPasswordProtected(tab.id) ? 'skipped' : state;
  }

  async function refreshBadge(tabId: number) {
    await recorder.ready;
    const tab = await chrome.tabs.get(tabId);
    const state = badges[stateFor(tab)];
    const unseen = unseenNotes();
    const text = unseen > 0 ? (unseen > 99 ? '99+' : String(unseen)) : state.text;
    const title = unseen > 0 ? `${state.title} · ${unseen} new field note${unseen === 1 ? '' : 's'}` : state.title;
    await Promise.all([chrome.action.setBadgeText({ tabId, text }), chrome.action.setTitle({ tabId, title })]);
  }

  async function refreshBadges() {
    await recorder.ready;
    await Promise.all((await chrome.tabs.query({ active: true })).map(({ id }) =>
      id === undefined ? undefined : refreshBadge(id).catch(() => {})));
  }

  const chatRules = ({ paused, skippedHosts, chatCapture }: RecordingSettings) => JSON.stringify([paused, skippedHosts, chatCapture ?? {}]);

  /** Chat tabs stop reading their composer, or start being admitted, as soon as the capture rules change. */
  async function rescreenChatTabs() {
    const tabs = await chrome.tabs.query({ url: Object.values(CHAT_SITES).map(({ host }) => `https://${host}/*`) });
    await Promise.all(tabs.map(({ id }) => id === undefined ? undefined : chrome.tabs.sendMessage(id, { type: RESCREEN_CHAT_MESSAGE }).catch(() => {})));
  }

  function changeSettings(edit: (current: RecordingSettings) => RecordingSettings, skipHost?: string) {
    let chatChanged = false;
    const written = recorder.changeRecordingPolicy(async () => {
      const next = edit(settings);
      // Block dispatch as soon as a skip begins, before the cascade runs.
      const previous = settings;
      settings = next;
      try { await saveRecordingSettings(next); }
      catch (error) { settings = previous; throw error; }
      chatChanged = chatRules(previous) !== chatRules(next);
      if (skipHost) await purge(skipHost);
      // Turning a chat site off removes what was captured from it.
      if (chatChanged) await purge(undefined, next);
    });
    settingsWritten = written.catch(() => {});
    return written.then(async () => {
      await refreshBadges();
      if (chatChanged) await rescreenChatTabs().catch(() => {});
    });
  }

  /** Use the same settings writer for future ignore-site actions. */
  function setSiteSkipped(host: string, skip: boolean) {
    return changeSettings((current) => ({
      ...current,
      skippedHosts: skip ? [...new Set([...current.skippedHosts, host])] : current.skippedHosts.filter((entry) => entry !== host),
    }), skip ? host : undefined);
  }

  async function getStatus(tabId: number | undefined): Promise<RecordingStatus> {
    await recorder.ready;
    await settingsWritten;
    const tab = tabId === undefined ? undefined : await chrome.tabs.get(tabId).catch(() => undefined);
    const host = siteKey(tab?.url);
    const paused = settings.paused;
    if (!tab || tabId === undefined || !host) return { paused };
    const skipped = recorder.isPasswordProtected(tabId) || recordingState(tab.url, { ...settings, paused: false }) === 'skipped';
    const editable = !recorder.isPasswordProtected(tabId) && recordingState(tab.url, {
      paused: false, skippedHosts: settings.skippedHosts.filter((entry) => entry !== host),
    }) === 'recording';
    return { paused, site: { tabId, host, state: stateFor(tab), skipped, editable } };
  }

  return {
    ready,
    refreshBadges,
    getSettings: () => settings,
    shouldRecord: (url: string) => recordingState(url, settings) === 'recording',
    shouldCaptureChat: (url: string) => chatCaptureAllowed(url, settings),
    setSiteSkipped,
    onPasswordStatusChanged(tabId: number) {
      void refreshBadge(tabId).catch(() => {});
      void chrome.runtime.sendMessage({ type: PASSWORD_STATUS_CHANGED }).catch(() => {});
    },
    start(visitRecorder: VisitRecorder) {
      recorder = visitRecorder;
      chrome.commands.onCommand.addListener((command) => {
        if (command === TOGGLE_RECORDING_COMMAND) {
          void changeSettings((current) => ({ ...current, paused: !current.paused })).catch(() => {});
        }
      });
      chrome.tabs.onActivated.addListener(({ tabId }) => void refreshBadge(tabId).catch(() => {}));
      chrome.tabs.onUpdated.addListener((tabId, change) => {
        // Chrome resets per-tab action badges on navigation.
        if (change.url || change.status) void refreshBadge(tabId).catch(() => {});
      });
      const panel = chrome.runtime.getURL('/sidepanel.html');
      const settingsPages = new Set(['/onboarding.html', '/settings.html'].map((path) => chrome.runtime.getURL(path)));
      chrome.runtime.onMessage.addListener((input: unknown, sender, reply) => {
        if (sender.id !== chrome.runtime.id || !isRecordingRequest(input)) return;
        const page = sender.url?.split(/[?#]/, 1)[0];
        if (!page) return;
        const fromSettings = settingsPages.has(page);
        if (page !== panel && !fromSettings) return;
        if ((input.action === 'edit-skip-list' || input.action === 'set-expedition-threshold' || input.action === 'set-use-my-notes' || input.action === 'set-chat-capture') && !fromSettings) return;
        if (fromSettings && (input.action === 'set-site' || (input.action === 'status' && input.tabId !== undefined))) return;
        void (async () => {
          switch (input.action) {
            case 'status': return getStatus(input.tabId);
            case 'set-pause': await changeSettings((current) => ({ ...current, paused: input.paused })); return true;
            case 'set-site': {
              const { site } = await getStatus(input.tabId);
              if (!site?.editable || site.host !== input.host) return false;
              await setSiteSkipped(site.host, input.skip);
              return true;
            }
            case 'set-expedition-threshold':
              await changeSettings((current) => ({ ...current, [input.threshold]: input.minutes }));
              return true;
            case 'set-use-my-notes':
              await changeSettings((current) => ({ ...current, useMyNotes: input.enabled }));
              return true;
            case 'set-chat-capture':
              await changeSettings((current) => ({ ...current, chatCapture: { ...current.chatCapture, [input.site]: input.enabled } }));
              return true;
            case 'edit-skip-list': {
              const value = input.site.trim();
              const url = URL.parse(value.includes('://') ? value : `https://${value}`);
              const host = siteKey(url?.href);
              if (!host || host.includes('*') || url?.username || url?.password) return false;
              await setSiteSkipped(host, input.skip);
              return true;
            }
          }
        })().then(reply, () => reply(false));
        return true;
      });
      void refreshBadges().catch(() => {});
    },
  };
}
