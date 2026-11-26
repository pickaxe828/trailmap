import { expect, test } from 'bun:test';
import { planOrganisation } from './organise';

test('selection merges into the earliest Expedition, not the first card clicked', () => {
  expect(planOrganisation([
    { id: 'later', startedAt: 2, endedAt: 3, kind: 'learning', threadId: null },
    { id: 'earlier', startedAt: 0, endedAt: 1, kind: 'learning', threadId: null },
  ], { action: 'merge' })).toEqual({ action: 'merge', intoId: 'earlier', fromIds: ['later'] });
});

test('starting a thread requires at least two lone, closed learning Expeditions', () => {
  const first = { id: 'first', startedAt: 0, endedAt: 1, kind: 'learning', threadId: null } as const;
  const second = { ...first, id: 'second' };
  expect(planOrganisation([first, first], { action: 'start' })).toBeNull();
  expect(planOrganisation([first, { ...second, threadId: 'other' }], { action: 'start' })).toBeNull();
  expect(planOrganisation([first, second], { action: 'start' })).toEqual({ action: 'start', expeditionIds: ['first', 'second'] });
});
