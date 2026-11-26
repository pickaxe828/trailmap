import { llmTaskGroup } from '@trailmap/shared';
import { liveQuery } from 'dexie';
import { getCompanionClient } from '../companion/background';
import { resolveConcepts } from '../concepts/resolve';
import { decideConceptMerges } from '../concepts/verdicts';
import type { TrailmapDb } from '../db/db';
import { getEmbedder } from '../embeddings/background';
import { enrichPage } from '../enrichment/handler';
import { onModelRoutesChanged, readModelRoutes } from '../llm/settings';
import type { RecordingSettings } from '../privacy/policy';
import { updateLivingNote } from '../threads/living-note';
import { threadNotesWritten } from '../threads/hooks';
import { matchThread } from '../threads/match';
import { wrapUpHandlers } from '../wrapup/handlers';
import { fieldNotesWritten } from '../wrapup/hooks';
import { JobQueue } from './queue';

const ALARM = 'trailmap.jobs';

/** Alarms recover due work even if the worker died after capture, claim or backoff. */
export function startJobs(db: TrailmapDb, ready: Promise<void>, getSettings: () => RecordingSettings): void {
  fieldNotesWritten.register(threadNotesWritten);
  const queue = new JobQueue(db, Date.now, {
    page_enrichment: enrichPage(db, getSettings),
    ...wrapUpHandlers(db, getSettings),
    concept_resolution: resolveConcepts(db, getEmbedder(), Date.now),
    merge_verdict: decideConceptMerges(db, getSettings, Date.now),
    thread_match: matchThread(db, getEmbedder(), Date.now),
    living_note: updateLivingNote(db, getSettings),
  }, [db.pages, db.expeditions, db.visits, db.concepts, db.conceptEvidence, db.edges, db.threads]);
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
        const account = await client.request('auth.status', {}).catch(() => undefined);
        if (account?.signedIn && account.planUsage) await queue.accountChanged();
      }
      while (client.supportsModelAudit && !getSettings().paused) {
        const routes = await readModelRoutes();
        // Use one snapshot for claim, dispatch and ChatGPT hold accounting.
        if (!await queue.runNext(({ kind }) => kind === 'concept_resolution' || kind === 'thread_match'
          ? undefined : routes[llmTaskGroup(kind)])) break;
      }
    }).catch(() => {}).finally(() => { pumping = false; });
  }
  chrome.alarms.onAlarm.addListener(({ name }) => { if (name === ALARM) kick(); });
  void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  // Start fresh jobs promptly while awake; correctness depends only on indexed
  // rows and the alarm, not on observing any particular in-memory event.
  liveQuery(() => db.jobs.where('status').equals('pending').count()).subscribe({ next: (count) => { if (count) kick(); } });
  client.subscribe(() => kick());
  onModelRoutesChanged(kick);
  client.onEvent((event) => {
    if (event.name === 'auth.completed') void queue.accountChanged(true).then(kick).catch(() => {});
  });
  kick();
}
