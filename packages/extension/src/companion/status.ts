import type { CompanionStatus } from './client';

/** `chrome.storage.session` key the background writes the connection status to, for UI pages to read. */
export const COMPANION_STATUS_KEY = 'trailmap.companionStatus';

/** UI pages send this to the background to retry the connection now (it also wakes a sleeping service worker). */
export const COMPANION_RECONNECT_MESSAGE = 'trailmap.companion.reconnect';

export const SETUP_INSTRUCTIONS_PATH = '/onboarding.html#companion';

/** What a page shows before the background has reported anything. */
export const INITIAL_COMPANION_STATUS: CompanionStatus = { state: 'connecting' };
