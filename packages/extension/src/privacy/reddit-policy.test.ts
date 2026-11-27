import { describe, expect, test } from 'bun:test';
import { isDefaultDenied, maySendToModel, recordingState, type RecordingSettings } from './policy';

const THREAD = 'https://www.reddit.com/r/databases/comments/abc123/why_does_compaction_hurt/';
const off: RecordingSettings = { paused: false, skippedHosts: [] };
const on: RecordingSettings = { ...off, redditThreads: true };

describe('opt-in Reddit thread pages', () => {
  test('are off by default: every reddit.com page, thread or feed, is skipped', () => {
    for (const url of [THREAD, 'https://old.reddit.com/r/databases/comments/abc123/', 'https://www.reddit.com/', 'https://www.reddit.com/r/databases/']) {
      expect(recordingState(url, off)).toBe('skipped');
      expect(recordingState(url, { ...off, redditThreads: false })).toBe('skipped');
      expect(isDefaultDenied(url)).toBe(true);
    }
  });

  test('after the opt-in only thread pages are recordable, on reddit.com, www and old', () => {
    for (const url of [THREAD, 'https://old.reddit.com/r/databases/comments/abc123/slug/?sort=top', 'https://reddit.com/r/databases/comments/abc123']) {
      expect(recordingState(url, on)).toBe('recording');
    }
  });

  test('feeds, profiles, inbox, settings, search and the front page stay denied even with the opt-in', () => {
    for (const url of [
      'https://www.reddit.com/', 'https://www.reddit.com/r/databases/', 'https://www.reddit.com/r/databases/new/',
      'https://www.reddit.com/r/all/', 'https://www.reddit.com/r/popular/', 'https://www.reddit.com/user/someone/',
      'https://www.reddit.com/user/someone/comments/abc123/slug/', 'https://www.reddit.com/r/u_someone/comments/abc123/slug/',
      'https://www.reddit.com/message/inbox/', 'https://www.reddit.com/settings/', 'https://www.reddit.com/search/?q=lsm',
      'https://www.reddit.com/r/databases/submit', 'https://old.reddit.com/prefs/', 'https://www.reddit.com/chat/',
      'https://www.reddit.com/r/databases/comments/', 'https://www.reddit.com/r/databases/comments/abc123/slug/checkout/',
    ]) {
      expect(recordingState(url, on)).toBe('skipped');
    }
  });

  test('the opt-in opens nothing but Reddit: other deny-list entries and lookalike hosts stay denied', () => {
    for (const url of ['https://x.com/r/databases/comments/abc123/',
      'http://www.reddit.com/r/databases/comments/abc123/',
      'https://user:pw@www.reddit.com/r/databases/comments/abc123/', 'https://mail.reddit.com/r/a/comments/abc123/']) {
      expect(recordingState(url, on)).toBe('skipped');
    }
  });

  test('pause and the skip list still apply to an opted-in thread', () => {
    expect(recordingState(THREAD, { ...on, paused: true })).toBe('paused');
    expect(recordingState(THREAD, { ...on, skippedHosts: ['reddit.com'] })).toBe('skipped');
    expect(recordingState(THREAD, { ...on, skippedHosts: ['www.reddit.com'] })).toBe('skipped');
    expect(recordingState(THREAD, { ...on, skippedHosts: ['old.reddit.com'] })).toBe('recording');
  });

  test('a Page from a thread reaches the model only while the opt-in holds', () => {
    const visit = { url: THREAD, canonicalUrl: THREAD, engagement: 'read' as const };
    const page = { canonicalUrl: THREAD, sourceUrl: THREAD, text: 'The post and comments.' };
    expect(maySendToModel(visit, page, on)).toBe(true);
    expect(maySendToModel(visit, page, off)).toBe(false);
    expect(maySendToModel(visit, page, { ...on, paused: true })).toBe(false);
    expect(maySendToModel(visit, page, { ...on, skippedHosts: ['reddit.com'] })).toBe(false);
    // A canonical link that points at a feed is not a thread page.
    const feed = 'https://www.reddit.com/r/databases/';
    expect(maySendToModel({ ...visit, canonicalUrl: feed }, { ...page, canonicalUrl: feed }, on)).toBe(false);
  });

  test('Hacker News is not on the deny-list', () => {
    expect(recordingState('https://news.ycombinator.com/item?id=4242001', off)).toBe('recording');
    expect(recordingState('https://news.ycombinator.com/item?id=4242001', { ...off, skippedHosts: ['news.ycombinator.com'] })).toBe('skipped');
  });
});
