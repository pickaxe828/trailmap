import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { FORUM_MAX_COMMENTS, extractForumThread, forumSiteOf, redditThreadUrl } from './forum';

const site = new URL('../../../../e2e/site/forum/', import.meta.url);
const OLD = 'https://old.reddit.com/r/databases/comments/abc123/why_does_compaction_hurt_write_throughput/';
const NEW = 'https://www.reddit.com/r/databases/comments/abc123/why_does_compaction_hurt_write_throughput/';
const HN = 'https://news.ycombinator.com/item?id=4242001';
const NAMES = ['otter_dev', 'compaction_fan', 'leveled_lover', 'plain_mention', 'write_amp', 'bloom_filter', 'flagged_user', 'sidebar_ghost',
  'some_account', 'mod_ghost'];

async function load(file: string, url: string) {
  const dom = new JSDOM(await Bun.file(new URL(file, site)).text(), { url });
  // The extractor uses DOM classes as globals, as it does in a content script.
  Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node });
  return dom.window.document;
}
const extract = async (file: string, url: string) => extractForumThread(await load(file, url), url);

describe('thread URLs', () => {
  test.each([
    'https://www.reddit.com/r/databases/comments/abc123/why_does_compaction_hurt/',
    'https://old.reddit.com/r/databases/comments/abc123/',
    'https://reddit.com/r/databases/comments/abc123',
    'https://www.reddit.com/r/databases/comments/abc123/slug/c1abc/?context=3#top',
  ])('%s is a Reddit thread page', (url) => {
    expect(redditThreadUrl(url)).toBe(true);
    expect(forumSiteOf(url)).toBe('reddit');
  });

  test.each([
    'https://www.reddit.com/',
    'https://www.reddit.com/r/databases/',
    'https://www.reddit.com/r/databases/hot/',
    'https://www.reddit.com/r/all/comments/',
    'https://www.reddit.com/user/someone/',
    'https://www.reddit.com/user/someone/comments/abc123/slug/',
    'https://www.reddit.com/u/someone/comments/abc123/slug/',
    'https://www.reddit.com/r/u_someone/comments/abc123/slug/',
    'https://www.reddit.com/message/inbox/',
    'https://www.reddit.com/settings/',
    'https://www.reddit.com/r/databases/submit',
    'https://www.reddit.com.evil.test/r/databases/comments/abc123/',
    'https://evil.test/r/databases/comments/abc123/',
    'https://i.reddit.com/r/databases/comments/abc123/',
    'http://www.reddit.com/r/databases/comments/abc123/',
    'https://user:pw@www.reddit.com/r/databases/comments/abc123/',
  ])('%s is not', (url) => {
    expect(redditThreadUrl(url)).toBe(false);
    expect(forumSiteOf(url)).toBeUndefined();
  });

  test('a Hacker News item is a forum page, the front page and users are not', () => {
    expect(forumSiteOf(HN)).toBe('hn');
    for (const url of ['https://news.ycombinator.com/', 'https://news.ycombinator.com/item', 'https://news.ycombinator.com/item?id=abc',
      'https://news.ycombinator.com/user?id=pg', 'https://news.ycombinator.com/newest', 'http://news.ycombinator.com/item?id=1',
      'https://news.ycombinator.com.evil.test/item?id=1', 'https://evil.test/item?id=1']) {
      expect(forumSiteOf(url)).toBeUndefined();
    }
  });
});

describe.each([['old Reddit', 'reddit-old.html', OLD], ['new Reddit', 'reddit-new.html', NEW], ['Hacker News', 'hn-item.html', HN]] as const)(
  '%s extractor', (_name, file, url) => {
    test('reads the post and its comments with their nesting depth', async () => {
      const result = (await extract(file, url))!;
      expect(result.text).toContain('Leveled');
      expect(result.text).toContain('compaction');
      expect(result.text).toContain('Size-tiered favours writes, leveled favours reads.');
      expect(result.text).toContain('Bloom filters per SSTable keep read amplification down');
      const reply = result.text.split('\n').find((line) => line.includes('Leveled compaction rewrites each byte'))!;
      const top = result.text.split('\n').find((line) => line.includes('Size-tiered favours writes'))!;
      expect(reply.search(/\S/)).toBeGreaterThan(top.search(/\S/)); // A reply is indented under its parent.
      expect(result.textHash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('keeps no user name: not authors, not user links quoted in a comment, not plain u/ mentions', async () => {
      const { text } = (await extract(file, url))!;
      for (const name of NAMES) expect(text).not.toContain(name);
      expect(text).not.toMatch(/\bu\/\w|\/user\/|user\?id=/);
      expect(text).toContain('Thanks to [user] for the benchmark');
    });

    test('leaves out removed or flagged comments, the sidebar and "more comments" controls', async () => {
      const { text } = (await extract(file, url))!;
      expect(text).not.toMatch(/\[deleted\]|\[removed\]|\[flagged\]|load more|View more comments|Subreddit rules|Hacker News/);
    });
  });

describe('post and comment layout', () => {
  test('old Reddit: title and body of the post come first', async () => {
    const { text } = (await extract('reddit-old.html', OLD))!;
    expect(text.startsWith('Why does compaction hurt write throughput?\n')).toBe(true);
    expect(text).toContain('Our LSM tree stalls writes whenever compaction runs. Is leveled or size-tiered compaction the better default');
  });
  test('Hacker News: the story text is the post body', async () => {
    const { text } = (await extract('hn-item.html', HN))!;
    expect(text.startsWith('Leveled versus size-tiered compaction\n')).toBe(true);
    expect(text).toContain('We moved a write-heavy table from leveled to size-tiered compaction');
  });
});

describe('defensive extraction', () => {
  test('an unknown layout yields nothing', async () => {
    expect(await extract('unknown-layout.html', OLD)).toBeNull();
    expect(await extract('unknown-layout.html', NEW)).toBeNull();
    expect(await extract('unknown-layout.html', HN)).toBeNull();
  });

  test('another site layout is not read as this site', async () => {
    expect(await extract('hn-item.html', OLD)).toBeNull();
    expect(await extract('reddit-new.html', HN)).toBeNull();
  });

  test('a page that is not a thread URL yields nothing, whatever the DOM', async () => {
    expect(await extract('reddit-old.html', 'https://www.reddit.com/r/databases/')).toBeNull();
    expect(await extract('hn-item.html', 'https://news.ycombinator.com/news')).toBeNull();
  });

  test('stale single-page DOM (the post is another thread) yields nothing', async () => {
    expect(await extract('reddit-new.html', 'https://www.reddit.com/r/databases/comments/zzz999/other/')).toBeNull();
    expect(await extract('reddit-old.html', 'https://old.reddit.com/r/databases/comments/zzz999/other/')).toBeNull();
    expect(await extract('hn-item.html', 'https://news.ycombinator.com/item?id=1')).toBeNull();
  });

  test('two posts on one page are ambiguous', async () => {
    const document = await load('reddit-new.html', NEW);
    document.body.append(document.querySelector('shreddit-post')!.cloneNode(true));
    expect(extractForumThread(document, NEW)).toBeNull();
  });
});

describe('caps', () => {
  const many = (count: number, extra = '') => {
    const comments = Array.from({ length: count }, (_, index) =>
      `<shreddit-comment depth="${index % 2}" author="n${index}"><div slot="comment"><p>Comment number ${index} ${extra}</p></div></shreddit-comment>`).join('');
    return `<shreddit-post id="t3_abc123"><h1 slot="title">Many comments</h1><div slot="text-body"><p>Body</p></div></shreddit-post>${comments}`;
  };
  const doc = (html: string) => {
    const dom = new JSDOM(`<body>${html}</body>`, { url: NEW });
    Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node });
    return dom.window.document;
  };

  test('keeps the first comments in page order, up to the cap', () => {
    const { text } = extractForumThread(doc(many(FORUM_MAX_COMMENTS + 25)), NEW)!;
    expect(text).toMatch(/Comment number 0$/m);
    expect(text).toMatch(new RegExp(`Comment number ${FORUM_MAX_COMMENTS - 1}$`, 'm'));
    expect(text).not.toMatch(new RegExp(`Comment number ${FORUM_MAX_COMMENTS}$`, 'm'));
  });

  test('a very long comment is shortened and the whole text stays within the Page text limit', () => {
    const { text } = extractForumThread(doc(many(FORUM_MAX_COMMENTS, 'word '.repeat(2_000))), NEW)!;
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(12_000);
    expect(text).toContain('Comment number 0 word');
  });

  test('a thread with no readable post yields nothing', () => {
    expect(extractForumThread(doc('<shreddit-post id="t3_abc123"></shreddit-post>'), NEW)).toBeNull();
  });
});
