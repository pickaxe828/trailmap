import {
  aiComposer, aiFormComposer, aiReplyBoundaries, aiSendComposer, findAiModeAnswer,
  AI_QUESTION_LIMIT, AI_RESULT_TIMEOUT_MS,
} from './google-ai-mode';
import type { AiCapture, PageContentReply } from './page-messages';
import { googleSearchSurface } from './search';

/** Only a trusted edit followed by a submit in the actual Mode composer starts capture. */
export function watchAiMode(document: Document, isPublic: () => boolean, send: (message: AiCapture) => Promise<PageContentReply | undefined>) {
  const drafts = new WeakMap<HTMLTextAreaElement, string>();
  const claimed = new WeakSet<Element>();
  const pending = new Map<string, { question: string; previous: Set<Element>; deadline: number }>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let watching = false;
  const inMode = () => googleSearchSurface(document.URL) === 'ai-mode';
  const observer = new MutationObserver(scheduleScan);

  function stopWatching() {
    observer.disconnect();
    watching = false;
    clearTimeout(deadlineTimer);
    clearTimeout(scanTimer);
    scanTimer = undefined;
  }

  function scheduleScan() {
    if (scanTimer === undefined) scanTimer = setTimeout(scan, 150);
  }

  function scan() {
    scanTimer = undefined;
    clearTimeout(deadlineTimer);
    if (!inMode() || !isPublic()) {
      pending.clear();
      stopWatching();
      return;
    }
    const now = Date.now();
    let deadline = Infinity;
    for (const [turnId, turn] of pending) {
      const found = findAiModeAnswer(document, turn.question, turn.previous);
      const reply = found && !claimed.has(found.boundary) ? found : undefined;
      if (!reply) {
        if (now < turn.deadline) {
          deadline = Math.min(deadline, turn.deadline);
          continue;
        }
      } else {
        claimed.add(reply.boundary);
      }
      pending.delete(turnId);
      void send({ kind: 'ai-result', turnId, result: reply?.result && now <= turn.deadline ? reply.result : null });
    }
    if (!pending.size) stopWatching();
    else deadlineTimer = setTimeout(scan, Math.max(0, deadline - now));
  }

  function track(id: string, question: string, previous = new Set<Element>()) {
    pending.set(id, { question, previous, deadline: Date.now() + AI_RESULT_TIMEOUT_MS });
    if (!watching) {
      observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['data-complete', 'aria-busy', 'href', 'hidden', 'aria-hidden'] });
      watching = true;
    }
    scheduleScan();
  }

  function edited(event: Event) {
    if (!event.isTrusted || !inMode() || !isPublic()) return;
    const field = aiComposer(event.target);
    if (field) drafts.set(field, field.value);
  }

  function submitted(field: HTMLTextAreaElement | undefined) {
    if (!field || !inMode() || !isPublic()) return;
    const question = field.value.trim();
    if (!question || drafts.get(field) !== field.value) return;
    drafts.delete(field); // Enter, click and submit can all fire for one turn.
    const turnId = crypto.randomUUID();
    const previous = aiReplyBoundaries(document);
    const typed = question.slice(0, AI_QUESTION_LIMIT);
    void send({ kind: 'ai-submit', turnId, question: typed }).then((reply) => {
      if (reply && inMode()) track(turnId, typed, previous);
    });
  }

  function keyed(event: KeyboardEvent) {
    if (event.isTrusted && !event.isComposing && !event.repeat && !event.shiftKey && !event.altKey &&
        !event.metaKey && !event.ctrlKey && event.key === 'Enter') submitted(aiComposer(event.target));
  }
  function clicked(event: MouseEvent) {
    if (event.isTrusted && inMode()) submitted(aiSendComposer(document, event.target));
  }
  function formSubmitted(event: SubmitEvent) {
    if (event.isTrusted && inMode()) submitted(aiFormComposer(event.target));
  }
  document.addEventListener('input', edited, true);
  document.addEventListener('keydown', keyed, true);
  document.addEventListener('click', clicked, true);
  document.addEventListener('submit', formSubmitted, true);

  return {
    resume(turns: NonNullable<PageContentReply['aiPending']>) {
      for (const { id, question } of turns) track(id, question);
    },
    clear() {
      pending.clear();
      stopWatching();
    },
    dispose() {
      this.clear();
      document.removeEventListener('input', edited, true);
      document.removeEventListener('keydown', keyed, true);
      document.removeEventListener('click', clicked, true);
      document.removeEventListener('submit', formSubmitted, true);
    },
  };
}
