import type { TrailmapDb } from '../db/db';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue';
import type { RecordingSettings } from '../privacy/policy';
import { digestTables, readDigestInput } from './input';
import type { DigestReply } from './messages';
import { catchUpWeek, lastSevenDays, localDateKey, type WeekRange } from './week';

/** The newest week already handled. A date key, not content: it survives Forget and keeps a week from being written twice. */
export type DigestLedger = { read(): Promise<string | undefined>; write(key: string): Promise<void> };
type Alarms = { create(name: string, info: { periodInMinutes: number }): unknown; onAlarm: { addListener(listener: (alarm: { name: string }) => void): void } };

export const DIGEST_ALARM = 'trailmap.digest';
const CHECK_EVERY_MINUTES = 60;

export type DigestClock = { now: () => number; zone: () => string };

/** Queue the digest of the last full week if it is due and not yet handled. Returns the week it queued. */
export async function runScheduledDigest(db: TrailmapDb, ledger: DigestLedger, { now, zone }: DigestClock): Promise<WeekRange | undefined> {
  const at = now();
  const week = catchUpWeek(at, zone(), await ledger.read());
  if (!week) return;
  // The job key is the week, so even a lost ledger cannot write the same week twice. A week with nothing to send is discarded by the job.
  await enqueueJob(db, { kind: 'weekly_digest', key: week.key, priority: JOB_PRIORITY.digest,
    payload: { id: week.key, kind: 'week', from: week.from, to: week.to } }, at);
  await ledger.write(week.key);
  return week;
}

/** Check at startup and then hourly (alarms outlive the worker, so a Monday missed while the browser was closed is caught up). */
export function startDigestSchedule(db: TrailmapDb, ready: Promise<unknown>, ledger: DigestLedger, clock: DigestClock, alarms: Alarms) {
  const check = () => void ready.then(() => runScheduledDigest(db, ledger, clock)).catch(() => {});
  alarms.onAlarm.addListener(({ name }) => { if (name === DIGEST_ALARM) check(); });
  void alarms.create(DIGEST_ALARM, { periodInMinutes: CHECK_EVERY_MINUTES });
  check();
}

/** "Generate this week's digest": the last 7 days, queued only when something from them may be sent. */
export async function requestRecentDigest(db: TrailmapDb, getSettings: () => RecordingSettings, { now, zone }: DigestClock): Promise<DigestReply> {
  const settings = getSettings();
  if (settings.paused) return { status: 'paused' };
  const at = now();
  const range = lastSevenDays(at);
  if (!await db.transaction('r', digestTables(db), () => readDigestInput(db, range, settings))) return { status: 'nothing' };
  // The id is the day, so asking again the same day replaces that digest; the key is the moment, so every ask is a new job.
  const id = `recent-${localDateKey(at, zone())}`;
  await enqueueJob(db, { kind: 'weekly_digest', key: `${id}@${at}`, priority: JOB_PRIORITY.digest, payload: { id, kind: 'recent', ...range } }, at);
  return { status: 'queued' };
}
