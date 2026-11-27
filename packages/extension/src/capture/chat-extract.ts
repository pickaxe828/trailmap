import type { AiSurface } from './ai-surface';
import { chatgptSelectors } from './chat/chatgpt';
import { claudeSelectors } from './chat/claude';
import { geminiSelectors } from './chat/gemini';
import { CHAT_SITES, chatSiteOf, type ChatSite } from './chat-sites';
import { AI_ANSWER_LIMIT, AI_CITATION_LIMIT, citationUrl, normalizeQuestion } from './google-ai-mode';

/** One site's undocumented markup. See `chat/<site>.ts`; nothing else in the extension knows these selectors. */
export type ChatSelectors = {
  composer: string;
  /** An enabled send control. */
  send: string;
  /** Each message the user typed, as rendered. */
  user: string;
  /** Each assistant reply boundary. */
  assistant: string;
  /** Present while a reply is being written. */
  busy: string;
  /** A positive "finished" marker for one reply. Unfinished or unknown means no capture. */
  complete(reply: Element): boolean;
  /** Extra site chrome to drop from a reply's text. */
  excluded: string;
};

// Never part of a reply's text, on any site.
const excluded = [
  'aside', '[role="complementary"]', '[role="region"][aria-label*="sources" i]', 'figure', 'img', 'svg', 'video', 'iframe',
  '[hidden]', '[inert]', '[aria-hidden="true"]', 'button', 'form', 'script', 'style', 'noscript', 'template', '[role="status"]',
  '[role="alert"]', 'textarea', 'input', 'select',
].join(',');
const blocks = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, br';

/** Visible text with a break between blocks. Used for composers and replies alike. */
function blockText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  copy.querySelectorAll('br').forEach((element) => element.replaceWith('\n'));
  copy.querySelectorAll(blocks).forEach((element) => {
    element.before('\n');
    element.after('\n');
  });
  return (copy.textContent ?? '').split('\n').map(normalizeQuestion).filter(Boolean).join('\n');
}

function createSurface(site: ChatSite, selectors: ChatSelectors): AiSurface {
  const composer = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(selectors.composer) ?? undefined : undefined;
  const drop = [excluded, selectors.excluded].filter(Boolean).join(',');
  const only = (document: Document) => {
    const fields = document.querySelectorAll<HTMLElement>(selectors.composer);
    return fields.length === 1 ? fields[0] : undefined;
  };
  const replies = (document: Document) => [...document.querySelectorAll(selectors.assistant)]
    .filter((reply) => !reply.parentElement?.closest(selectors.assistant));

  return {
    active: (document) => chatSiteOf(document.URL) === site,
    composer,
    formComposer(target) {
      if (!(target instanceof HTMLFormElement)) return;
      const fields = target.querySelectorAll<HTMLElement>(selectors.composer);
      return fields.length === 1 ? fields[0] : undefined;
    },
    sendComposer(document, target) {
      if (!(target instanceof Element) || !target.closest(selectors.send)) return;
      return only(document);
    },
    read: (field) => field instanceof HTMLTextAreaElement ? field.value : blockText(field),
    busy: (document) => !!document.querySelector(selectors.busy),
    boundaries: (document) => new Set(replies(document)),
    find(document, question, boundaries) {
      const wanted = normalizeQuestion(question);
      const users = [...document.querySelectorAll(selectors.user)];
      const matches = replies(document).filter((reply) => {
        if (boundaries.has(reply)) return false;
        // The message the user typed is the nearest user message before this reply.
        const asked = users.findLast((user) => !!(user.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING));
        return !!asked && normalizeQuestion(blockText(asked)) === wanted;
      });
      if (matches.length !== 1) return;
      const reply = matches[0]!;
      if (!selectors.complete(reply)) return;
      const copy = reply.cloneNode(true) as Element;
      copy.querySelectorAll(drop).forEach((element) => element.remove());
      const citations = [...new Set([...copy.querySelectorAll('a[href]')].flatMap((link) => {
        const href = citationUrl(link.getAttribute('href') ?? '', document.URL);
        return href ? [href] : [];
      }))].slice(0, AI_CITATION_LIMIT);
      const answer = blockText(copy).slice(0, AI_ANSWER_LIMIT);
      return { boundary: reply, result: answer ? { answer, citations } : null };
    },
  };
}

export const CHAT_SURFACES: Record<ChatSite, AiSurface> = {
  gemini: createSurface('gemini', geminiSelectors),
  chatgpt: createSurface('chatgpt', chatgptSelectors),
  claude: createSurface('claude', claudeSelectors),
};

/** The extractor for the site this document belongs to, if it is one of the chat assistants. */
export const chatSurfaceFor = (url: string) => {
  const site = chatSiteOf(url);
  return site ? { site, label: CHAT_SITES[site].label, surface: CHAT_SURFACES[site] } : undefined;
};
