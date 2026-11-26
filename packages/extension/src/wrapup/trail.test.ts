import { expect, test } from 'bun:test';
import type { Expedition, Highlight, Page, Query, Visit } from '@trailmap/shared';
import { displayFieldNotes } from './markdown';
import { buildFieldNotesInput, buildWrapUpInput, renderFieldNotes, type TrailSources } from './trail';

const settings = { paused: false, skippedHosts: ['skipped.test'] };
const expedition: Expedition = {
  id: 'expedition:v1', rootVisitId: 'search', title: 'crdt tombstones', drivingQuestion: null, kind: 'learning',
  startedAt: 1000, endedAt: 9000, fieldNotes: null, userEdited: false, threadId: null,
};
const visit = (id: string, host: string, extra: Partial<Visit> = {}): Visit => ({
  id, url: `https://${host}/${id}`, canonicalUrl: `https://${host}/${id}`, title: `Title ${id}`, tabId: 1,
  parentVisitId: null, transition: 'link', startedAt: 1000, activeMs: 70_000, scrollDepth: 0.8,
  engagement: 'read', expeditionId: expedition.id, ...extra,
});
const page = (v: Visit, extra: Partial<Page> = {}): Page => ({
  canonicalUrl: v.canonicalUrl, text: `Body of ${v.id}`, textHash: `hash-${v.id}`, sourceUrl: v.url, sourceVisitId: v.id,
  summary: `Summary of ${v.id}`, takeaways: [`Takeaway one of ${v.id}`, `Takeaway two of ${v.id}`], embedding: null,
  pageKind: 'article', enrichedAt: 5000, ...extra,
});

function sources(): TrailSources {
  const search = visit('search', 'search.test', { transition: 'typed', startedAt: 1000, engagement: 'bounced' });
  const first = visit('first', 'learn.test', { parentVisitId: 'search', startedAt: 2000 });
  const second = visit('second', 'docs.test', { parentVisitId: 'first', startedAt: 3000, engagement: 'skimmed' });
  const unread = visit('unread', 'unread.test', { parentVisitId: 'search', startedAt: 2500, engagement: 'bounced' });
  const skipped = visit('skipped', 'skipped.test', { parentVisitId: 'first', startedAt: 3500 });
  const blocked = visit('blocked', 'blocked.test', { parentVisitId: 'first', startedAt: 3600, privacyBlocked: true });
  const queries: Query[] = [{ id: 'q', visitId: 'search', engine: 'search.test', q: 'what is a tombstone', at: 1000, expeditionId: expedition.id }];
  const highlights: Highlight[] = [{ id: 'h', visitId: 'first', canonicalUrl: first.canonicalUrl, text: 'tombstones keep deletes', at: 2100, source: 'selection' }];
  const visits = [blocked, second, skipped, unread, first, search]; // deliberately unordered
  return { expedition, visits, pages: visits.filter((v) => v.id !== 'search').map((v) => page(v)), highlights, queries, sourceVisits: visits };
}

test('the wrap-up input lists searches and read Pages in trail order and leaves out bounced, skipped and private Visits', () => {
  const built = buildWrapUpInput({ ...sources(), sameDay: [] }, settings)!;
  expect(built.input.trail.map((entry) => [entry.ref, 'q' in entry ? entry.q : entry.title])).toEqual([
    ['q1', 'what is a tombstone'], ['p1', 'Title first'], ['p2', 'Title second'],
  ]);
  expect(built.input.trail[1]).toMatchObject({
    ref: 'p1', cameFrom: 'q1', engagement: 'read', summary: 'Summary of first',
    highlights: ['tombstones keep deletes'],
  });
  expect(built.input.trail[2]).toMatchObject({ cameFrom: 'p1', engagement: 'skimmed' });
  const text = JSON.stringify(built.input);
  for (const hidden of ['unread.test', 'skipped.test', 'blocked.test', 'Body of']) expect(text).not.toContain(hidden);
});

test('an allowed alias never sends a skipped alias highlight or cached enrichment', () => {
  const s = sources();
  const first = s.visits.find(({ id }) => id === 'first')!;
  const skipped = s.visits.find(({ id }) => id === 'skipped')!;
  skipped.canonicalUrl = first.canonicalUrl;
  s.pages = [page(first, { enrichmentVisitId: skipped.id, summary: 'private summary' })];
  s.highlights.push({ id: 'secret', visitId: skipped.id, text: 'private highlight', at: 2200, source: 'copy' });
  for (const built of [buildWrapUpInput({ ...s, sameDay: [] }, settings), buildFieldNotesInput(s, settings)]) {
    expect(JSON.stringify(built?.input)).toContain('tombstones keep deletes');
    expect(JSON.stringify(built?.input)).not.toContain('private');
  }
});

test('an Expedition with nothing eligible to send produces no input', () => {
  const everything = sources();
  const onlyBounced = { ...everything, visits: everything.visits.filter((v) => v.engagement === 'bounced' && v.id !== 'search'),
    queries: [], pages: [], highlights: [] };
  expect(buildWrapUpInput({ ...onlyBounced, sameDay: [] }, settings)).toBeUndefined();
});

test('same-day Expeditions are offered under short ids, hiding any whose root is skipped', () => {
  const ok = { ...expedition, id: 'expedition:a', rootVisitId: 'a', title: 'CRDT basics', drivingQuestion: 'What is a CRDT?' };
  const hidden = { ...expedition, id: 'expedition:b', rootVisitId: 'b', title: 'Secret topic' };
  const built = buildWrapUpInput({
    ...sources(),
    sameDay: [
      { expedition: ok, root: visit('a', 'learn.test') },
      { expedition: hidden, root: visit('b', 'skipped.test') },
    ],
  }, settings)!;
  expect(built.input.sameDay).toEqual([{ id: 'e1', title: 'CRDT basics', drivingQuestion: 'What is a CRDT?' }]);
  expect(built.sameDayIds.get('e1')).toBe('expedition:a');
  expect(JSON.stringify(built.input)).not.toContain('Secret topic');
});

test('field notes follow the §4.6 sections, cite each key idea by Page, and list unread tabs as loose ends', () => {
  const built = buildFieldNotesInput({ ...sources(), expedition: { ...expedition, title: 'Tombstones', drivingQuestion: 'How do CRDTs delete?' } }, settings)!;
  expect(built.input.expedition).toEqual({ title: 'Tombstones', drivingQuestion: 'How do CRDTs delete?' });
  const markdown = renderFieldNotes({
    found: 'Tombstones mark deletes.',
    key_ideas: [{ idea: 'A tombstone preserves history', page: 'p1' }, { idea: 'Made-up claim', page: 'p9' }, { idea: 'Docs agree', page: 'p2' }],
    trail: 'Started with a search, then read two pages.',
    loose_ends: ['How are tombstones garbage collected?'],
  }, built);
  expect(markdown).not.toContain('unread.test');
  expect(displayFieldNotes({ fieldNotes: markdown, unreadStops: built.unread })).toBe([
    '## Question', '', 'How do CRDTs delete?', '',
    '## What you found', '', 'Tombstones mark deletes.', '',
    '## Key ideas', '',
    '- A tombstone preserves history ([Title first](https://learn.test/first))',
    '- Docs agree ([Title second](https://docs.test/second))', '',
    '## How the trail went', '', 'Started with a search, then read two pages.', '',
    '## Loose ends', '',
    '- Opened but never read: [Title unread](https://unread.test/unread)',
    '- How are tombstones garbage collected?', '',
  ].join('\n'));
});

test('link text from page titles cannot break out of the Markdown', () => {
  const s = sources();
  s.visits = s.visits.map((v) => v.id === 'first' ? { ...v, title: 'A [tricky] title\nwith lines' } : v);
  const built = buildFieldNotesInput({ ...s, expedition: { ...expedition, drivingQuestion: 'Q?' } }, settings)!;
  const markdown = renderFieldNotes({ found: 'x', key_ideas: [{ idea: 'idea', page: 'p1' }], trail: 'y', loose_ends: [] }, built);
  expect(markdown).toContain('([A \\[tricky\\] title with lines](https://learn.test/first))');
  expect(markdown).not.toContain('\nwith lines');
});
