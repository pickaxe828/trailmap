import type { RecordingState } from './policy';

export const RECORDING_MESSAGE = 'trailmap.recording';
export const PASSWORD_STATUS_CHANGED = 'trailmap.passwordStatusChanged';
export const TOGGLE_RECORDING_COMMAND = 'toggle-recording';

export type RecordingRequest = { type: typeof RECORDING_MESSAGE } & (
  | { action: 'status'; tabId?: number }
  | { action: 'set-pause'; paused: boolean }
  | { action: 'set-site'; tabId: number; host: string; skip: boolean }
  | { action: 'edit-skip-list'; site: string; skip: boolean }
);

export type RecordingStatus = {
  paused: boolean;
  site?: { tabId: number; host: string; state: RecordingState; skipped: boolean; editable: boolean };
};

export function isRecordingRequest(value: unknown): value is RecordingRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  if (request.type !== RECORDING_MESSAGE) return false;
  switch (request.action) {
    case 'status': return request.tabId === undefined || Number.isInteger(request.tabId);
    case 'set-pause': return typeof request.paused === 'boolean';
    case 'set-site': return Number.isInteger(request.tabId) && typeof request.host === 'string' && typeof request.skip === 'boolean';
    case 'edit-skip-list': return typeof request.site === 'string' && typeof request.skip === 'boolean';
    default: return false;
  }
}
