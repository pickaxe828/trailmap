import { expect, test } from 'bun:test';
import { Visit } from './domain';

test('Visit schema accepts a well-formed Visit and rejects an unknown engagement level', () => {
  const visit = {
    id: 'v1',
    url: 'http://learn.test/a',
    canonicalUrl: 'http://learn.test/a',
    title: 'A',
    tabId: 1,
    parentVisitId: null,
    transition: 'typed',
    startedAt: 0,
    activeMs: 0,
    scrollDepth: 0,
    engagement: 'bounced',
    expeditionId: null,
  };
  expect(Visit.safeParse(visit).success).toBe(true);
  expect(Visit.safeParse({ ...visit, engagement: 'devoured' }).success).toBe(false);
});
