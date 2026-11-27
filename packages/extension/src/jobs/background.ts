import { llmTaskGroup } from '@trailmap/shared';
import { liveQuery } from 'dexie';
import { getCompanionClient } from '../companion/background';
import { resolveConcepts } from '../concepts/resolve';
import { decideConceptMerges } from '../concepts/verdicts';
import type { TrailmapDb } from '../db/db';
import { getEmbedder } from '../embeddings/background';
import { writeDigest } from '../digest/handler';
import { enrichPage } from '../enrichment/handler';
import { onModelRoutesChanged, readModelRoutes } from '../llm/settings';
import { usesMyNotes, type RecordingSettings } from '../privacy/policy';
import { RECORDING_SETTINGS_KEY } from '../privacy/settings';
import { enqueueAllMyNotes } from '../notes/enqueue';
import { enrichNotes } from '../notes/handler';
import { updateLivingNote } from '../threads/living-note';
import { threadNotesWritten } from '../threads/hooks';
import { matchThread } from '../threads/match';
import { wrapUpHandlers } from '../wrapup/handlers';
import { fieldNotesWritten } from '../wrapup/hooks';
import { JobQueue } from './queue';
import { isModelJob, RETRY_MODEL_JOBS } from './types';

const ALARM = 'trailmap.jobs';

/** Alarms recover due work even if the worker died after capture, claim or backoff. */
export function startJobs(db: TrailmapDb, ready: Promise<void>, getSettings: () => RecordingSettings): void {
  fieldNotesWritten.register(threadNotesWritten);
  const queue = new JobQueue(db, Date.now, {
    page_enrichment: enrichPage(db, getSettings),
    ...wrapUpHandlers(db, getSettings),
    concept_resolution: resolveConcepts(db, getEmbedder(), Date.now),
    merge_verdict: decideConceptMerges(db, getSettings, Date.now),
    thread_match: matchThread(db, getEmbedder(), Date.now, getSettings),
    living_note: updateLivingNote(db, getSettings),
    notes_enrichment: enrichNotes(db, getSettings, getEmbedder()),
    weekly_digest: writeDigest(db, getSettings),
  }, [db.pages, db.expeditions, db.visits, db.concepts, db.conceptEvidence, db.edges, db.threads, db.highlights, db.queries, db.notes, db.threadMatchRuns, db.dismissedConcepts, db.digests]);
  const client = getCompanionClient();
  let pumping = false;
  let retryRequested = false;
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
        if (!await queue.runNext(({ kind }) => isModelJob(kind) ? routes[llmTaskGroup(kind)] : undefined)) break;
      }
    }).catch(() => {}).finally(() => {
      pumping = false;
      if (retryRequested) {
        retryRequested = false;
        kick();
      }
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const kind: unknown = message?.kind;
    if (message?.type !== RETRY_MODEL_JOBS || !isModelJob(kind) || sender.id !== chrome.runtime.id ||
      sender.url?.split(/[?#]/, 1)[0] !== chrome.runtime.getURL('/settings.html')) return;
    void ready.then(async () => {
      const route = (await readModelRoutes())[llmTaskGroup(kind)];
      const queued = await queue.retryNow(kind, route);
      if (queued) {
        if (pumping) retryRequested = true;
        else kick();
      }
      respond({ queued });
    }).catch(() => respond({ queued: 0 }));
    return true;
  });
  // Switching "Use my notes" back on asks about notes written while it was off.
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[RECORDING_SETTINGS_KEY] as { oldValue?: RecordingSettings; newValue?: RecordingSettings } | undefined;
    if (area === 'local' && change?.newValue && !usesMyNotes(change.oldValue ?? {}) && usesMyNotes(change.newValue)) {
      void ready.then(() => enqueueAllMyNotes(db, Date.now())).catch(() => {});
    }
  });
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
