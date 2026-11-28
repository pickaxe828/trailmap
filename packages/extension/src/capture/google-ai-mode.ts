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
// The initial result and replies appended by the conversation have different envelopes.
// In both, the reply heading is a sibling of the answer layout, not inside the main column.
const initialHost = 'section.bzXtMb > div:has(> div[jsname="coFSxe"])';
const initialReply = `${initialHost} .CKgc1d > div[data-subtree] > div.FkX2oe`;
const followUpReply = 'div[jsname="RH7zg"] .CKgc1d > div[data-subtree] > div.Zkbeff';
const replyEnvelope = `${initialReply}, ${followUpReply}`;
const replyHeading = ':scope > h3[data-ignore-copy]:is(.MheKwc, .iMqumd)';
const answerColumn = ':scope > div.pWvJNd > div[data-container-id="main-col"][jsname="KFl8ub"]';
const suggestionControl = '.AHmQrc .n6owBd span.yrZ5Oe.dWeLse[role="link"][aria-disabled="false"]';
const excluded = [
  'aside', '[role="complementary"]', '[data-container-id="side-col"]', '[aria-roledescription="carousel" i]',
  '[role="region"][aria-label*="sources" i]', 'g-scrolling-carousel', 'figure', 'img', 'svg', 'video', 'iframe',
  '[hidden]', '[inert]', '[aria-hidden="true"]', 'button', 'form', 'script', 'style', 'noscript', 'template',
  '[role="status"]', '[role="alert"]', '[role="dialog"]',
  '.AHmQrc', 'div:has(> .DBd2Wb)', // Suggested follow-ups and related result cards.
].join(',');
const citationControls = '.Wg1cdb';
const headingPrefix = 'AI Mode reply for ';

export const AI_QUESTION_LIMIT = 4_000;
export const AI_ANSWER_LIMIT = 20_000;
export const AI_CITATION_LIMIT = 30;
export const AI_RESULT_TIMEOUT_MS = 120_000;
export const normalizeQuestion = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The snapshot shows both a Search tab link and a button styled as a link. */
export function isAiModeEntryControl(document: Document, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest('a.XVMlrc.C6AK7c[href], button.Sw4CSc.plR5qb[role="link"]:not(:disabled)');
  if (!control || control.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')) return false;
  const label = normalizeQuestion(control.textContent ?? '');
  if (control.tagName === 'BUTTON') return label === 'AI Mode' || label === 'Dive deeper in AI Mode';
  if (label !== 'AI Mode' && label !== 'Dive deeper in AI Mode') return false;
  const href = URL.parse(control.getAttribute('href') ?? '', document.baseURI);
  const targetName = control.getAttribute('target');
  return !!href && (!targetName || targetName === '_self') && !control.hasAttribute('download') &&
    href.origin === URL.parse(document.URL)?.origin && googleSearchSurface(href.href) === 'ai-mode';
}

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
  const fields = (button.form ?? button.closest('.AgWCw') ?? document).querySelectorAll<HTMLTextAreaElement>(composer);
  if (fields.length === 1) return fields[0];
}

function aiSuggestedQuestion(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element) || target.closest('a, button, [role="button"]')) return;
  const control = target.closest(suggestionControl);
  if (!control || control.closest('[hidden], [inert], [aria-hidden="true"]')) return;
  const column = control.closest('[data-container-id="main-col"][jsname="KFl8ub"]');
  const reply = column?.closest(replyEnvelope);
  if (!reply || !column || !replyIsComplete(reply) || reply.closest(excluded) || column.closest(excluded)) return;
  const labels = control.querySelectorAll(':scope > span.lXgGAe');
  if (labels.length === 1) return normalizeQuestion(labels[0]!.textContent ?? '') || undefined;
}

/** Snapshot existing reply boundaries so sending an identical question doesn't claim an old reply. */
export function aiReplyBoundaries(document: Document): Set<Element> {
  return new Set(document.querySelectorAll(replyEnvelope));
}

function replyIsComplete(reply: Element): boolean {
  const completion = reply.matches(initialReply) ? reply.closest(initialHost) : reply;
  return !!completion?.matches('[data-complete="true"]') &&
    !reply.closest('[aria-busy="true"], [data-is-streaming="true"], [data-complete="false"]');
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
  const expected = headingPrefix + normalizeQuestion(question);
  const matches = [...aiReplyBoundaries(document)].filter((reply) => {
    if (excludedBoundaries.has(reply) || reply.closest(excluded)) return false;
    const headings = reply.querySelectorAll(replyHeading);
    return headings.length === 1 && normalizeQuestion(headings[0]!.textContent ?? '') === expected;
  });
  if (matches.length !== 1) return;
  const reply = matches[0]!;
  if (!replyIsComplete(reply)) return;
  const columns = reply.querySelectorAll(answerColumn);
  const body = columns.length === 1 ? columns[0]!.firstElementChild : undefined;
  // The prose is the first div; reply actions are its sibling. No fallback to the layout or page.
  if (!body?.matches('div:not(.alk4p)') || body.closest(excluded) ||
      !body.querySelector('.n6owBd, .XSq4R, .ZLzG0d, table.nOQsj')) return { boundary: reply, result: null };
  const copy = body.cloneNode(true) as Element;
  copy.querySelectorAll(excluded).forEach((element) => element.remove());
  const citations = [...new Set([...copy.querySelectorAll('a[href]')].flatMap((link) => {
    const href = citationUrl(link.getAttribute('href') ?? '', document.URL);
    return href ? [href] : [];
  }))].slice(0, AI_CITATION_LIMIT);
  copy.querySelectorAll(citationControls).forEach((element) => element.remove());
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
  suggestedQuestion: aiSuggestedQuestion,
  read: (field) => (field as HTMLTextAreaElement).value,
  boundaries: aiReplyBoundaries,
  find: findAiModeAnswer,
};
