import type { AiSurface } from './ai-surface';
import { canonicalizeUrl } from './canonical';
import { googleSearchSurface } from './search';

// Undocumented Google AI Mode DOM. Keep all selectors here. If the reply envelope
// or completion markers disappear, don't fall back to scraping the whole page.
const composer = [
  'textarea[aria-label="Ask anything" i]', 'textarea[placeholder="Ask anything" i]',
  'form:has(input[name="udm"][value="50"]) textarea[name="q"]',
].join(',');
const sendButton = 'button[aria-label="Send" i]:not(:disabled)';
const replyHeading = '[data-container-id="main-col"] h3';
const excluded = [
  'aside', '[role="complementary"]', '[data-container-id="side-col"]', '[aria-roledescription="carousel" i]',
  '[role="region"][aria-label*="sources" i]', 'g-scrolling-carousel', 'figure', 'img', 'svg', 'video', 'iframe',
  '[hidden]', '[inert]', '[aria-hidden="true"]', 'button', 'form', 'script', 'style', 'noscript', 'template',
  '[role="status"]', '[role="alert"]',
].join(',');
const citationControls = 'sup:has(a[href], button[aria-label="Related results" i]), a[role="doc-biblioref"], .Fwa2Od, span.wJwe6c';
const footer = 'AI responses may include mistakes.';
const headingPrefix = 'AI Mode reply for ';

export const AI_QUESTION_LIMIT = 4_000;
export const AI_ANSWER_LIMIT = 20_000;
export const AI_CITATION_LIMIT = 30;
export const AI_RESULT_TIMEOUT_MS = 120_000;
export const normalizeQuestion = (text: string) => text.replace(/\s+/g, ' ').trim();

export function aiComposer(target: EventTarget | null): HTMLTextAreaElement | undefined {
  return target instanceof Element && target.matches(composer) ? target as HTMLTextAreaElement : undefined;
}

export function aiFormComposer(target: EventTarget | null): HTMLTextAreaElement | undefined {
  if (!(target instanceof HTMLFormElement)) return;
  const fields = target.querySelectorAll<HTMLTextAreaElement>(composer);
  if (fields.length === 1) return fields[0];
}

export function aiSendComposer(document: Document, target: EventTarget | null): HTMLTextAreaElement | undefined {
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>(sendButton);
  if (!button) return;
  const fields = (button.form ?? document).querySelectorAll<HTMLTextAreaElement>(composer);
  if (fields.length === 1) return fields[0];
}

/** Snapshot existing reply boundaries so sending an identical question doesn't claim an old reply. */
export function aiReplyBoundaries(document: Document): Set<Element> {
  return new Set([...document.querySelectorAll(replyHeading)].filter((heading) =>
    heading.textContent?.startsWith(headingPrefix)).flatMap((heading) => heading.parentElement ? [heading.parentElement] : []));
}

export type AiAnswer = { answer: string; citations: string[] };

export function citationUrl(value: string, base: string): string | undefined {
  let url = URL.parse(value, base);
  if (url?.origin === URL.parse(base)?.origin && url?.pathname === '/url') {
    url = URL.parse(url.searchParams.get('url') ?? url.searchParams.get('q') ?? '');
  }
  if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password || url.origin === URL.parse(base)?.origin) return;
  const clean = canonicalizeUrl(url.href);
  if (clean.length <= 2_048) return clean;
}

/** Read only a complete reply paired with a question known to have been submitted. */
export function extractAiModeAnswer(document: Document, question: string | undefined,
  excludedBoundaries: ReadonlySet<Element> = new Set()): AiAnswer | undefined {
  return findAiModeAnswer(document, question, excludedBoundaries)?.result ?? undefined;
}

export function findAiModeAnswer(document: Document, question: string | undefined,
  excludedBoundaries: ReadonlySet<Element>) {
  if (!question || googleSearchSurface(document.URL) !== 'ai-mode') return;
  const matches = [...document.querySelectorAll(replyHeading)].filter((heading) =>
    normalizeQuestion(heading.textContent ?? '') === headingPrefix + normalizeQuestion(question) &&
    heading.parentElement && !excludedBoundaries.has(heading.parentElement) && !heading.parentElement.closest(excluded));
  if (matches.length !== 1) return;
  const heading = matches[0]!;
  const reply = heading.parentElement!;
  if (reply.matches('[aria-busy="true"], [data-complete="false"]')) return;
  const copy = reply.cloneNode(true) as Element;
  // Keep citation boundaries while dropping hidden blocks and the side panel.
  const controls = copy.querySelectorAll(citationControls);
  copy.querySelectorAll(excluded).forEach((element) => element.remove());
  const footers = [...copy.querySelectorAll('p, div, span')].filter(({ textContent }) => normalizeQuestion(textContent ?? '') === footer);
  if (!reply.matches('[data-complete="true"], [data-complete="1"]') && !footers.length) return;
  footers.forEach((element) => element.remove());
  // The matched reply heading is not answer text. Do not remove subheadings in the answer.
  [...copy.querySelectorAll('h3')].find((element) => element.textContent === heading.textContent)?.remove();
  const citations = [...new Set([...copy.querySelectorAll('a[href]')].flatMap((link) => {
    const href = citationUrl(link.getAttribute('href') ?? '', document.URL);
    return href ? [href] : [];
  }))].slice(0, AI_CITATION_LIMIT);
  controls.forEach((element) => element.remove());
  copy.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, br').forEach((element) => {
    element.before('\n');
    element.after('\n');
  });
  const answer = (copy.textContent ?? '').split('\n').map(normalizeQuestion).filter(Boolean).join('\n').slice(0, AI_ANSWER_LIMIT);
  return { boundary: reply, result: answer ? { answer, citations } : null };
}

/** Google AI Mode as a surface for the shared conversation watcher. */
export const googleAiModeSurface: AiSurface = {
  active: (document) => googleSearchSurface(document.URL) === 'ai-mode',
  composer: aiComposer,
  formComposer: aiFormComposer,
  sendComposer: aiSendComposer,
  read: (field) => (field as HTMLTextAreaElement).value,
  boundaries: aiReplyBoundaries,
  find: findAiModeAnswer,
};
