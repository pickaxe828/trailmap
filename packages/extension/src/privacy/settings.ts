import { DEFAULT_EXPEDITION_INACTIVITY_MINUTES, DEFAULT_TOPIC_SWITCH_MINUTES, validExpeditionMinutes } from '../segmentation/config';
import type { RecordingSettings } from './policy';

export const RECORDING_SETTINGS_KEY = 'trailmap.recordingSettings';
const defaults: RecordingSettings = { paused: false, skippedHosts: [] };

export async function readRecordingSettings(): Promise<RecordingSettings> {
  const { [RECORDING_SETTINGS_KEY]: settings } = await chrome.storage.local.get({ [RECORDING_SETTINGS_KEY]: defaults });
  return settings as RecordingSettings;
}

export function expeditionCloseSettings({ expeditionInactivityMinutes, topicSwitchMinutes }: RecordingSettings) {
  return {
    expeditionInactivityMinutes: validExpeditionMinutes(expeditionInactivityMinutes)
      ? expeditionInactivityMinutes : DEFAULT_EXPEDITION_INACTIVITY_MINUTES,
    topicSwitchMinutes: validExpeditionMinutes(topicSwitchMinutes) ? topicSwitchMinutes : DEFAULT_TOPIC_SWITCH_MINUTES,
  };
}

export type ExpeditionThreshold = keyof ReturnType<typeof expeditionCloseSettings>;

export function saveRecordingSettings(settings: RecordingSettings): Promise<void> {
  return chrome.storage.local.set({ [RECORDING_SETTINGS_KEY]: settings });
}
