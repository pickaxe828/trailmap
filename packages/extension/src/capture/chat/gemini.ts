import type { ChatSelectors } from '../chat-extract';

// Undocumented Gemini DOM. Every selector for this site lives here.
export const geminiSelectors: ChatSelectors = {
  composer: 'rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"]',
  send: 'button[aria-label="Send message" i]:not(:disabled):not([aria-disabled="true"])',
  user: 'user-query .query-text',
  assistant: 'model-response message-content',
  busy: 'message-content[aria-busy="true"]',
  complete: (reply) => reply.getAttribute('aria-busy') !== 'true' &&
    !!reply.closest('model-response')?.querySelector('button[aria-label="Copy" i], [data-test-id="copy-button"]'),
  excluded: '',
};
