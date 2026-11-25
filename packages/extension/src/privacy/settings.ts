import type { RecordingSettings } from './policy';

export const RECORDING_SETTINGS_KEY = 'trailmap.recordingSettings';
const defaults: RecordingSettings = { paused: false, skippedHosts: [] };

export async function readRecordingSettings(): Promise<RecordingSettings> {
  const { [RECORDING_SETTINGS_KEY]: settings } = await chrome.storage.local.get({ [RECORDING_SETTINGS_KEY]: defaults });
  return settings as RecordingSettings;
}

export function saveRecordingSettings(settings: RecordingSettings): Promise<void> {
  return chrome.storage.local.set({ [RECORDING_SETTINGS_KEY]: settings });
}
