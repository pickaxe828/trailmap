import { expect, test } from 'bun:test';
import type { Expedition } from '@trailmap/shared';
import { mergeSuggestionsByExpedition } from './suggestions';

const expedition = (id: string, extra: Partial<Expedition> = {}): Expedition => ({
  id, title: id, startedAt: 0, endedAt: 1, kind: 'learning', centroid: null,
  threadId: null, fieldNotes: null, userEdited: false, drivingQuestion: null, ...extra,
});

test('a merge suggestion appears on both cards and either card can dismiss the pair', () => {
  const a = expedition('a', { mergeSuggestions: [{ expeditionId: 'b', reason: 'Same topic' }, { expeditionId: 'gone', reason: 'Stale' }] });
  const b = expedition('b');
  expect(mergeSuggestionsByExpedition([a, b])).toEqual(new Map([['a', [b]], ['b', [a]]]));
  expect(mergeSuggestionsByExpedition([a, { ...b, dismissedSuggestions: [{ kind: 'expedition', id: 'a' }] }]).size).toBe(0);
});
