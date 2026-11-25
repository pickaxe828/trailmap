import { IDLE_SECONDS, TICK_ALARM } from '../capture/chrome-events';
import type { IdleState } from '../capture/events';
import type { VisitRecorder } from '../capture/recorder';
import { getEmbedder } from '../embeddings/background';
import { EXPEDITION_IDLE_SECONDS } from './config';
import { ExpeditionRecorder } from './expedition-recorder';
import { expeditionIdle } from './idle';
import type { TrailmapDb } from '../db/db';
import { isWrapUpRequest } from '../wrapup/messages';

const IDLE_KEY = 'trailmap.expeditionIdleDeadline';
const CLOSE_ALARM = 'trailmap.expedition-close';

export function startSegmentation(db: TrailmapDb, recorder: VisitRecorder) {
  const expeditions = new ExpeditionRecorder({ db, embedder: getEmbedder(), now: Date.now });
  let queue = Promise.resolve();

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => {});
  };

  async function checkIdle(at: number, event?: IdleState) {
    const previous = (await chrome.storage.session.get({ [IDLE_KEY]: null }))[IDLE_KEY] as number | null;
    const state = event ?? await chrome.idle.queryState(IDLE_SECONDS);
    const transition = expeditionIdle(previous, state, at);
    if (state === 'idle' && transition.closeAt === null &&
        await chrome.idle.queryState(EXPEDITION_IDLE_SECONDS) === 'idle') {
      // On startup the user may already have been idle for the full interval.
      transition.deadline = transition.closeAt = at;
    }

    // Save a newly discovered deadline before draining Visits, and retain
    // an overdue one until its closure commits. Either can outlive this worker.
    if (transition.deadline !== null && transition.deadline !== previous) {
      await chrome.storage.session.set({ [IDLE_KEY]: transition.deadline });
    }
    if (transition.closeAt !== null) await expeditions.close(transition.closeAt);
    if (transition.deadline === null && previous !== null) {
      await chrome.storage.session.remove(IDLE_KEY);
    }
    if (transition.deadline !== null && transition.deadline > at) {
      if (!(await chrome.alarms.get(CLOSE_ALARM))) {
        await chrome.alarms.create(CLOSE_ALARM, { when: transition.deadline });
      }
    } else {
      await chrome.alarms.clear(CLOSE_ALARM);
    }
  }

  function observeIdle(event?: IdleState) {
    const at = Date.now();
    enqueue(() => checkIdle(at, event));
  }

  function sync() {
    // Inference has its own queue. Let idle notifications register while a
    // model is loading, and preserve their order against subsequent Visits.
    enqueue(async () => { void expeditions.sync().catch(() => {}); });
  }

  // Wrap up closes one Expedition now instead of waiting for 30 minutes of idle.
  chrome.runtime.onMessage.addListener((input: unknown, sender, reply) => {
    if (sender.url !== chrome.runtime.getURL('/sidepanel.html') || !isWrapUpRequest(input)) return;
    const done = Promise.withResolvers<boolean>();
    queue = queue.then(() => expeditions.close(Date.now(), input.expeditionId)).then(() => done.resolve(true), () => done.resolve(false));
    void done.promise.then(reply);
    return true;
  });

  recorder.subscribe((change) => {
    if (change.type === 'created' || change.titleChanged) sync();
  });
  chrome.idle.onStateChanged.addListener(observeIdle);
  chrome.alarms.onAlarm.addListener(({ name }) => {
    if (name === TICK_ALARM || name === CLOSE_ALARM) {
      observeIdle();
      sync();
    }
  });
  observeIdle();
  sync();
}
