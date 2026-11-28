import { CHAT_SITE_IDS, type ChatSite } from '../capture/chat-sites';
import { validExpeditionMinutes } from '../segmentation/config';
import type { RecordingState } from './policy';
import type { ExpeditionThreshold } from './settings';

export const RECORDING_MESSAGE = 'trailmap.recording';
export const PASSWORD_STATUS_CHANGED = 'trailmap.passwordStatusChanged';
export const TOGGLE_RECORDING_COMMAND = 'toggle-recording';

export type RecordingRequest = { type: typeof RECORDING_MESSAGE } & (
  | { action: 'status'; tabId?: number }
  | { action: 'set-pause'; paused: boolean }
  | { action: 'set-site'; tabId: number; host: string; skip: boolean }
  | { action: 'edit-skip-list'; site: string; skip: boolean }
  | { action: 'set-expedition-threshold'; threshold: ExpeditionThreshold; minutes: number }
  | { action: 'set-use-my-notes'; enabled: boolean }
  | { action: 'set-chat-capture'; site: ChatSite; enabled: boolean }
  | { action: 'set-reddit-threads'; enabled: boolean }
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
    case 'set-expedition-threshold': return (request.threshold === 'expeditionInactivityMinutes' || request.threshold === 'topicSwitchMinutes') &&
      validExpeditionMinutes(request.minutes);
    case 'set-use-my-notes': return typeof request.enabled === 'boolean';
    case 'set-chat-capture': return CHAT_SITE_IDS.includes(request.site as ChatSite) && typeof request.enabled === 'boolean';
    case 'set-reddit-threads': return typeof request.enabled === 'boolean';
    default: return false;
  }
}
