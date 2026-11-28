import type { ChatSelectors } from '../chat-extract';

// Undocumented Claude DOM. Every selector for this site lives here.
export const claudeSelectors: ChatSelectors = {
  composer: 'div[contenteditable="true"][data-testid="chat-input"], div.ProseMirror[contenteditable="true"][aria-label*="prompt" i]',
  send: 'button[aria-label="Send message" i]:not(:disabled)',
  user: '[data-testid="user-message"]',
  assistant: '[data-is-streaming]',
  busy: '[data-is-streaming="true"]',
  complete: (reply) => reply.getAttribute('data-is-streaming') === 'false',
  excluded: '',
};
