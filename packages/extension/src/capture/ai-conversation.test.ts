import { expect, test } from 'bun:test';
import { mergeAiTurn } from './ai-conversation';

test('merges independently delivered replies into their typed turns in submission order', () => {
  const first = { kind: 'ai-submit', turnId: 'first', question: 'Why?' } as const;
  const second = { kind: 'ai-submit', turnId: 'second', question: 'Why?' } as const;
  const reply = { kind: 'ai-result', turnId: 'second', result: { answer: 'Because.', citations: [] } } as const;
  const turns = mergeAiTurn(mergeAiTurn([], first), second);
  const updated = mergeAiTurn(turns, { ...reply, result: { ...reply.result, citations: [] } });
  expect(mergeAiTurn(updated, first)).toBe(updated);
  expect(mergeAiTurn(updated, { kind: 'ai-result', turnId: 'first', result: null })).toEqual([
    { id: 'first', question: 'Why?', answer: null, citations: [], extractionFailed: true },
    { id: 'second', question: 'Why?', answer: 'Because.', citations: [] },
  ]);
  expect(mergeAiTurn(updated, { kind: 'ai-result', turnId: 'never-typed', result: null })).toBe(updated);
});
