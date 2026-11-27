import type { AiSurface } from './ai-surface';
import { AI_QUESTION_LIMIT, AI_RESULT_TIMEOUT_MS } from './google-ai-mode';
import type { AiCapture, PageContentReply } from './page-messages';

type WatchOptions = {
  /** Only real user input counts. Tests substitute their own. */
  trusted?: (event: Event) => boolean;
};

/**
 * Only a trusted edit followed by a submit in the surface's own composer starts capture, and only while
 * the document is admitted (`isPublic`). Until then the composer is never read, so nothing typed before a
 * site is opted in or screened can ever be captured, not even in memory.
 */
export function watchAiConversation(document: Document, surface: AiSurface, isPublic: () => boolean,
  send: (message: AiCapture) => Promise<PageContentReply | undefined>, { trusted = (event) => event.isTrusted }: WatchOptions = {}) {
  const drafts = new WeakMap<HTMLElement, string>();
  const claimed = new WeakSet<Element>();
  const pending = new Map<string, { question: string; previous: Set<Element>; deadline: number }>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let watching = false;
  const active = () => surface.active(document);
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
    if (!active() || !isPublic()) {
      pending.clear();
      stopWatching();
      return;
    }
    const now = Date.now();
    let deadline = Infinity;
    for (const [turnId, turn] of pending) {
      const found = surface.find(document, turn.question, turn.previous);
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
        attributeFilter: ['data-complete', 'data-is-streaming', 'aria-busy', 'href', 'hidden', 'aria-hidden', 'disabled'] });
      watching = true;
    }
    scheduleScan();
  }

  function edited(event: Event) {
    if (!trusted(event) || !active() || !isPublic()) return;
    const field = surface.composer(event.target);
    if (field) drafts.set(field, surface.read(field));
  }

  function submitted(field: HTMLElement | undefined) {
    if (!field || !active() || !isPublic()) return;
    const text = surface.read(field);
    const question = text.trim();
    if (!question || drafts.get(field) !== text) return;
    drafts.delete(field); // Enter, click and submit can all fire for one turn.
    const turnId = crypto.randomUUID();
    const previous = surface.boundaries(document);
    const typed = question.slice(0, AI_QUESTION_LIMIT);
    void send({ kind: 'ai-submit', turnId, question: typed }).then((reply) => {
      if (reply && active()) track(turnId, typed, previous);
    });
  }

  function keyed(event: KeyboardEvent) {
    if (trusted(event) && !event.isComposing && !event.repeat && !event.shiftKey && !event.altKey &&
        !event.metaKey && !event.ctrlKey && event.key === 'Enter' && !surface.busy?.(document)) submitted(surface.composer(event.target));
  }
  function clicked(event: MouseEvent) {
    if (trusted(event) && active()) submitted(surface.sendComposer(document, event.target));
  }
  function formSubmitted(event: SubmitEvent) {
    if (trusted(event) && active()) submitted(surface.formComposer(event.target));
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
