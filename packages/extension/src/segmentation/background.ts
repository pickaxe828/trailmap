import { IDLE_SECONDS, TICK_ALARM } from '../capture/chrome-events';
import type { IdleState } from '../capture/events';
import type { VisitRecorder } from '../capture/recorder';
import type { TrailmapDb } from '../db/db';
import { getEmbedder } from '../embeddings/background';
import type { RecordingSettings } from '../privacy/policy';
import { expeditionCloseSettings, RECORDING_SETTINGS_KEY } from '../privacy/settings';
import { isWrapUpRequest } from '../wrapup/messages';
import { CLOSE_ALARM, scheduleExpeditionClose } from './close-alarm';
import { EXPEDITION_IDLE_SECONDS } from './config';
import { ExpeditionRecorder } from './expedition-recorder';
import { expeditionIdle } from './idle';

const IDLE_KEY = 'trailmap.expeditionIdleDeadline';
const SESSION_START_KEY = 'trailmap.expeditionSessionStartedAt';

export function startSegmentation(db: TrailmapDb, recorder: VisitRecorder, getSettings: () => RecordingSettings) {
  const workerStartedAt = Date.now();
  async function idleDeadline() {
    return (await chrome.storage.session.get({ [IDLE_KEY]: null }))[IDLE_KEY] as number | null;
  }
  const expeditions = new ExpeditionRecorder({
    db, embedder: getEmbedder(), now: Date.now,
    timing: () => {
      const { expeditionInactivityMinutes, topicSwitchMinutes } = expeditionCloseSettings(getSettings());
      return { inactivityMs: expeditionInactivityMinutes * 60_000, topicSwitchMs: topicSwitchMinutes * 60_000 };
    },
    onDeadline: async (deadline) => {
      const idle = await idleDeadline();
      await scheduleExpeditionClose(chrome.alarms, deadline, idle !== null && idle > Date.now() ? idle : null);
    },
  });
  let queue = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };

  async function checkIdle(at: number, event?: IdleState) {
    const previous = await idleDeadline();
    const state = event ?? await chrome.idle.queryState(IDLE_SECONDS);
    const transition = expeditionIdle(previous, state, at);
    if (state === 'idle' && transition.closeAt === null &&
        await chrome.idle.queryState(EXPEDITION_IDLE_SECONDS) === 'idle') {
      // On wake the user may already have been idle for the full interval.
      transition.deadline = transition.closeAt = at;
    }

    // Preserve the cutoff if the worker stops before the closure transaction.
    if (transition.deadline !== null && transition.deadline !== previous) {
      await chrome.storage.session.set({ [IDLE_KEY]: transition.deadline });
    }
    if (transition.closeAt !== null) await expeditions.close(transition.closeAt);
    if (transition.deadline === null && previous !== null) await chrome.storage.session.remove(IDLE_KEY);
  }

  function sync() {
    // Assignment has its own queue. Let idle observations save their cutoff
    // even while a Visit is waiting for its embedding.
    void expeditions.sync().catch(() => {});
  }

  async function reconcile(idleEvent?: { at: number; state: IdleState }) {
    // Always settle current reading before deciding that an Expedition is stale.
    await recorder.flushActiveTime();
    await checkIdle(idleEvent?.at ?? Date.now(), idleEvent?.state);
    sync();
  }

  void enqueue(async () => {
    // Session storage survives worker suspension, but not a browser restart.
    // Persist the boundary before closing so an interrupted sweep is retried.
    const stored = (await chrome.storage.session.get(SESSION_START_KEY))[SESSION_START_KEY] as number | undefined;
    const start = stored ?? workerStartedAt;
    if (stored === undefined) await chrome.storage.session.set({ [SESSION_START_KEY]: start });
    await recorder.ready;
    await expeditions.recover(start);
    await reconcile();
  });

  chrome.runtime.onMessage.addListener((input: unknown, sender, reply) => {
    if (sender.url !== chrome.runtime.getURL('/sidepanel.html') || !isWrapUpRequest(input)) return;
    const at = Date.now();
    const closed = enqueue(async () => {
      await recorder.flushActiveTime();
      await expeditions.close(at, input.expeditionId);
    });
    void closed.then(() => reply(true), () => reply(false));
    void enqueue(async () => sync());
    return true;
  });

  recorder.subscribe((change) => {
    if (change.type === 'created' || change.titleChanged) void enqueue(async () => sync());
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[RECORDING_SETTINGS_KEY]) return;
    const change = changes[RECORDING_SETTINGS_KEY] as { oldValue?: RecordingSettings; newValue?: RecordingSettings };
    const { oldValue, newValue } = change;
    if (oldValue?.expeditionInactivityMinutes !== newValue?.expeditionInactivityMinutes ||
        oldValue?.topicSwitchMinutes !== newValue?.topicSwitchMinutes) void enqueue(() => reconcile());
  });
  chrome.idle.onStateChanged.addListener((state) => {
    const at = Date.now();
    void enqueue(() => reconcile({ at, state }));
  });
  chrome.alarms.onAlarm.addListener(({ name }) => {
    if (name === TICK_ALARM || name === CLOSE_ALARM) void enqueue(() => reconcile());
  });
  return expeditions;
}
