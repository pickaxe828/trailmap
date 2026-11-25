import { liveQuery } from 'dexie';
import { getCompanionClient } from '../companion/background';
import type { TrailmapDb } from '../db/db';
import { enrichPage } from '../enrichment/handler';
import type { RecordingSettings } from '../privacy/policy';
import { JobQueue } from './queue';

const ALARM = 'trailmap.jobs';

/** Alarms recover due work even if the worker died after capture, claim or backoff. */
export function startJobs(db: TrailmapDb, ready: Promise<void>, getSettings: () => RecordingSettings): void {
  const queue = new JobQueue(db, Date.now, { page_enrichment: enrichPage(db, getSettings) }, [db.pages]);
  const client = getCompanionClient();
  let pumping = false;
  function kick() {
    if (pumping || !client.supportsModelAudit) return;
    pumping = true;
    void ready.then(async () => {
      const hold = await db.queueHolds.get('ai');
      if (hold?.reason === 'not_signed_in' || hold?.reason === 'plan_usage_not_granted') {
        // Auth may have committed just before a worker crash or after a stale
        // model attempt saw the old account state. Recover without sending text.
        const { signedIn, planUsage } = await client.request('auth.status', {});
        if (signedIn && planUsage) await queue.accountChanged();
      }
      while (client.supportsModelAudit && !getSettings().paused && await queue.runNext()) { /* drain ready jobs */ }
    }).catch(() => {}).finally(() => { pumping = false; });
  }
  chrome.alarms.onAlarm.addListener(({ name }) => { if (name === ALARM) kick(); });
  void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  // Start fresh jobs promptly while awake; correctness depends only on indexed
  // rows and the alarm, not on observing any particular in-memory event.
  liveQuery(() => db.jobs.where('status').equals('pending').count()).subscribe({ next: (count) => { if (count) kick(); } });
  client.subscribe(() => kick());
  client.onEvent((event) => {
    if (event.name === 'auth.completed') void queue.accountChanged(true).then(kick).catch(() => {});
  });
  kick();
}
