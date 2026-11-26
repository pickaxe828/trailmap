export const CLOSE_ALARM = 'trailmap.expedition-close';

type AlarmClock = {
  get(name: string): Promise<{ scheduledTime: number } | undefined>;
  create(name: string, info: { when: number }): Promise<void>;
  clear(name: string): Promise<boolean>;
};

export async function scheduleExpeditionClose(clock: AlarmClock, expedition: number | null, idle: number | null) {
  const next = Math.min(expedition ?? Infinity, idle ?? Infinity);
  const existing = await clock.get(CLOSE_ALARM);
  if (next === Infinity) {
    if (existing) await clock.clear(CLOSE_ALARM);
  } else if (existing?.scheduledTime !== next) {
    await clock.create(CLOSE_ALARM, { when: next });
  }
}
