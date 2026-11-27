import { expect, test } from 'bun:test';
import type { Expedition, Highlight, Visit } from '@trailmap/shared';
import { newPage } from '../capture/pages';
import { buildEnrichmentInput } from './input';

const visit: Visit = {
  id: 'current', url: 'https://docs.test/delete?utm_source=tracker', canonicalUrl: 'https://docs.test/delete',
  title: 'Deleting items', tabId: 1, parentVisitId: 'parent', transition: 'link', startedAt: 1, activeMs: 1,
  scrollDepth: 0.8, engagement: 'read', expeditionId: 'expedition',
};
const parent: Visit = { ...visit, id: 'parent', title: 'Replicated lists', url: 'https://learn.test/lists', canonicalUrl: 'https://learn.test/lists' };
const root: Visit = { ...parent, id: 'root', url: 'https://search.test/query', canonicalUrl: 'https://search.test/query' };
const expedition: Expedition = {
  id: 'expedition', rootVisitId: 'root', title: 'CRDT deletion', drivingQuestion: null, kind: 'learning',
  startedAt: 1, endedAt: null, fieldNotes: null, userEdited: false, threadId: null,
};
const highlight: Highlight = { id: 'h1', text: 'Keep the marker', at: 1, visitId: 'current', source: 'selection' };
const page = { ...newPage(visit.canonicalUrl, 'Causal history.', 'hash'), sourceUrl: visit.canonicalUrl };

test('enrichment sends the canonical URL, important Highlights and the provisional Expedition title', () => {
  const input = buildEnrichmentInput({ visit, page, highlights: [highlight], expedition, root, parent }, { paused: false, skippedHosts: [] });
  expect(input).toEqual({
    title: 'Deleting items', url: 'https://docs.test/delete', text: 'Causal history.',
    highlights: [{ text: 'Keep the marker', important: true }],
    drivingQuestion: 'CRDT deletion', parentTitle: 'Replicated lists',
  });
});

test('use the driving question when available, omit skipped/private context and unrelated Highlights, and cap multibyte text', () => {
  const input = buildEnrichmentInput({
    visit, page: { ...page, text: '🌱'.repeat(3_001) + 'too far' },
    highlights: [highlight, { ...highlight, id: 'h2', visitId: 'parent', text: 'Unrelated' }],
    expedition: { ...expedition, drivingQuestion: 'How do deletes work?' }, root, parent,
  }, { paused: false, skippedHosts: ['learn.test'] });
  expect(input).toMatchObject({
    text: '🌱'.repeat(3_000), highlights: [{ text: 'Keep the marker', important: true }],
    drivingQuestion: 'How do deletes work?', parentTitle: null,
  });
});

test('bounced Visits and skipped Page sources do not produce a model input', () => {
  expect(buildEnrichmentInput({ visit: { ...visit, engagement: 'bounced' }, page, highlights: [] }, { paused: false, skippedHosts: [] })).toBeUndefined();
  expect(buildEnrichmentInput({ visit, page: { ...page, sourceUrl: 'https://skipped.test/delete' }, highlights: [] }, { paused: false, skippedHosts: ['skipped.test'] })).toBeUndefined();
});

test('a YouTube watch Page is sent as a video transcript, through the same privacy gate', () => {
  const url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
  const video = { ...visit, url, canonicalUrl: url, title: 'LSM trees', watchMs: 50_000, parentVisitId: null };
  const transcript = { ...newPage(url, 'A memtable buffers writes.', 'hash'), sourceUrl: url };
  expect(buildEnrichmentInput({ visit: video, page: transcript, highlights: [] }, { paused: false, skippedHosts: [] }))
    .toMatchObject({ contentKind: 'video', text: 'A memtable buffers writes.' });
  for (const settings of [{ paused: true, skippedHosts: [] }, { paused: false, skippedHosts: ['youtube.com'] }]) {
    expect(buildEnrichmentInput({ visit: video, page: transcript, highlights: [] }, settings)).toBeUndefined();
  }
});

test('a PDF Page is sent as a pdf document, through the same privacy gate as any Page', () => {
  const url = 'https://papers.test/lsm.pdf';
  const paper = { ...visit, url, canonicalUrl: url, title: 'LSM trees', pdf: true as const, parentVisitId: null };
  const text = { ...newPage(url, 'A memtable buffers writes.', 'hash'), sourceUrl: url };
  expect(buildEnrichmentInput({ visit: paper, page: text, highlights: [] }, { paused: false, skippedHosts: [] }))
    .toMatchObject({ contentKind: 'pdf', title: 'LSM trees', url, text: 'A memtable buffers writes.' });
  for (const settings of [{ paused: true, skippedHosts: [] }, { paused: false, skippedHosts: ['papers.test'] }]) {
    expect(buildEnrichmentInput({ visit: paper, page: text, highlights: [] }, settings)).toBeUndefined();
  }
  // A password-protected or bounced Visit sends nothing, and neither does a Page that has no text layer.
  expect(buildEnrichmentInput({ visit: { ...paper, privacyBlocked: true }, page: text, highlights: [] }, { paused: false, skippedHosts: [] })).toBeUndefined();
  expect(buildEnrichmentInput({ visit: { ...paper, engagement: 'bounced' }, page: text, highlights: [] }, { paused: false, skippedHosts: [] })).toBeUndefined();
});

test('a forum thread is sent as contentKind forum, through the same privacy gate and only while Reddit is opted in', () => {
  for (const url of ['https://news.ycombinator.com/item?id=4242001', 'https://www.reddit.com/r/databases/comments/abc123/why/']) {
    const thread = { ...visit, url, canonicalUrl: url, title: 'LSM trees', parentVisitId: null };
    const text = { ...newPage(url, 'Why compaction?\n- Size-tiered favours writes.', 'hash'), sourceUrl: url };
    const settings = { paused: false, skippedHosts: [], redditThreads: true };
    expect(buildEnrichmentInput({ visit: thread, page: text, highlights: [] }, settings))
      .toMatchObject({ contentKind: 'forum', text: 'Why compaction?\n- Size-tiered favours writes.' });
    for (const blocked of [{ ...settings, paused: true }, { ...settings, skippedHosts: [new URL(url).hostname] }, { ...settings, redditThreads: false }]) {
      if (blocked.redditThreads === false && url.includes('ycombinator')) continue; // HN needs no opt-in
      expect(buildEnrichmentInput({ visit: thread, page: text, highlights: [] }, blocked)).toBeUndefined();
    }
  }
});
