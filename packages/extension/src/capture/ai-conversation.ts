import type { AiTurn, Page, Visit } from '@trailmap/shared';
import { cap } from '../enrichment/input';
import { hashText } from './extract';
import type { AiCapture } from './page-messages';
import { PAGE_TEXT_BYTE_LIMIT } from './page-messages';
import { newPage } from './pages';

/** Ignore replays, late replies for unknown turns, and a second result for a finished turn. */
export function mergeAiTurn(turns: AiTurn[], message: AiCapture): AiTurn[] {
  const found = turns.find(({ id }) => id === message.turnId);
  if (message.kind === 'ai-submit') {
    return found ? turns : [...turns, { id: message.turnId, question: message.question, answer: null, citations: [] }];
  }
  if (!found || found.answer !== null || found.extractionFailed) return turns;
  const result = message.result ?? { extractionFailed: true as const };
  return turns.map((turn) => turn === found ? { ...turn, ...result } : turn);
}

export function aiEngagement(activeMs: number, turns: number): Visit['engagement'] {
  return turns >= 2 || activeMs > 60_000 ? 'read' : 'skimmed';
}

export function pendingAiTurns(page: Page | undefined) {
  return page?.aiTurns?.filter(({ answer, extractionFailed }) => answer === null && !extractionFailed) ?? [];
}

export function conversationPage(visit: Visit, previous: Page | undefined, aiTurns: AiTurn[]): Page {
  // Only an extracted reply makes a conversation eligible for inference. Keep all
  // turns for local review; the Page text is the bounded enrichment transcript.
  const perTurn = Math.floor(PAGE_TEXT_BYTE_LIMIT / aiTurns.length);
  const text = aiTurns.some(({ answer }) => !!answer) ? cap(aiTurns.map(({ question, answer }) => {
    const prompt = `User question (what I wanted to learn): ${cap(question, Math.max(1, Math.floor(perTurn / 2)))}`;
    return cap(`${prompt}${answer ? `\nAI-generated answer: ${answer}` : ''}`, Math.max(1, perTurn - 2));
  }).join('\n\n'), PAGE_TEXT_BYTE_LIMIT) : '';
  const current = !!previous && previous.text === text;
  // A dispatched job for the same bounded text can have been fenced off while
  // waiting for a reply. Give the settled transcript a new job version in that case.
  const settled = previous && pendingAiTurns(previous).length && aiTurns.every(({ answer, extractionFailed }) => answer !== null || extractionFailed);
  const textRevision = current && !(settled && previous.enrichedAt === null) ? previous.textRevision : (previous?.textRevision ?? 0) + 1;
  return {
    ...(current ? previous : newPage(visit.canonicalUrl, text, hashText(text))),
    aiTurns, textRevision, sourceUrl: visit.url, sourceVisitId: visit.id,
  };
}