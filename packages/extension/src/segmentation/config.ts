export const ROOT_SIMILARITY = 0.6;
export const EXPEDITION_WINDOW_MS = 2 * 60 * 60 * 1000;
export const EXPEDITION_IDLE_SECONDS = 30 * 60;
export const VISIT_TITLE_GRACE_MS = 2_000;

export const DEFAULT_EXPEDITION_INACTIVITY_MINUTES = 20;
export const DEFAULT_TOPIC_SWITCH_MINUTES = 10;
export const MIN_EXPEDITION_MINUTES = 1;
export const MAX_EXPEDITION_MINUTES = 24 * 60;

export function validExpeditionMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= MIN_EXPEDITION_MINUTES && value <= MAX_EXPEDITION_MINUTES;
}
