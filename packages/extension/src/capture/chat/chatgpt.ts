import type { ChatSelectors } from '../chat-extract';

// Undocumented ChatGPT DOM. Every selector for this site lives here. If a marker disappears the
// extractor finds nothing and the turn keeps only its question.
export const chatgptSelectors: ChatSelectors = {
  composer: '#prompt-textarea',
  send: 'button[data-testid="send-button"]:not(:disabled)',
  user: '[data-message-author-role="user"]',
  assistant: '[data-message-author-role="assistant"]',
  busy: 'button[data-testid="stop-button"]',
  complete: (reply) => !!reply.closest('article, [data-testid^="conversation-turn"]')?.querySelector('button[data-testid="copy-turn-action-button"]'),
  excluded: '',
};
