import { describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { extractVideoText, youtubeWatchId } from './youtube';

const site = new URL('../../../../e2e/site/youtube/', import.meta.url);
const read = (name: string) => Bun.file(new URL(name, site)).text();
const WATCH = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const NEXT = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const watchText = 'Log-structured merge trees explained A walkthrough of memtables, SSTables and compaction.';
const nextText = 'Compaction strategies, no captions Leveled versus size-tiered compaction in an LSM tree.';
const dom = (html: string) => new JSDOM(html).window.document;

describe('youtubeWatchId', () => {
  test.each([
    ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'aaaaaaaaaaa'],
    ['https://youtube.com/watch?v=aaaaaaaaaaa&t=30s', 'aaaaaaaaaaa'],
    ['https://m.youtube.com/watch?v=a-b_cD1234E', 'a-b_cD1234E'],
  ])('%s is a watch page', (url, id) => expect(youtubeWatchId(url)).toBe(id));

  test.each([
    'https://www.youtube.com/results?search_query=lsm',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/shorts/aaaaaaaaaaa',
    'https://www.youtube.com.evil.test/watch?v=aaaaaaaaaaa',
    'https://evil.test/watch?v=aaaaaaaaaaa',
    'http://www.youtube.com/watch?v=aaaaaaaaaaa',
    'https://music.youtube.com/watch?v=aaaaaaaaaaa',
  ])('%s is not', (url) => expect(youtubeWatchId(url)).toBeUndefined());
});

describe('extractVideoText', () => {
  test('a captioned watch page keeps the title and description without a fetch', async () => {
    const fetchWatchHtml = mock(async () => '');
    const result = await extractVideoText({ document: dom(await read('watch.html')), url: WATCH, fetchWatchHtml });
    expect(fetchWatchHtml).not.toHaveBeenCalled();
    expect(result).toEqual({ text: watchText, textHash: new Bun.CryptoHasher('sha256').update(watchText).digest('hex') });
  });

  test('a watch page without captions also keeps the title and description', async () => {
    const result = await extractVideoText({ document: dom(await read('watch-no-captions.html')), url: NEXT });
    expect(result?.text).toBe(nextText);
  });

  test('a stale inline response is ignored and only the new watch URL is fetched', async () => {
    const fetchWatchHtml = mock(async (_url: string) => read('watch-no-captions.html'));
    const result = await extractVideoText({ document: dom(await read('watch.html')), url: NEXT, fetchWatchHtml });
    expect(fetchWatchHtml.mock.calls).toEqual([[NEXT]]);
    expect(result?.text).toBe(nextText);
  });

  test('a fetched response still has to match the new video', async () => {
    const stale = await read('watch.html');
    const result = await extractVideoText({ document: dom(stale), url: NEXT, fetchWatchHtml: async () => stale });
    expect(result).toBeNull();
  });

  test.each([
    ['no player response', '<h1>Redesigned</h1><p>Unrelated recommended video</p>'],
    ['malformed JSON', '<script>var ytInitialPlayerResponse = {bad};</script>'],
    ['a different shape', '<script>var ytInitialPlayerResponse = {"videoDetails":"nope"};</script>'],
    ['an unexpected description', '<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"aaaaaaaaaaa","title":"title","shortDescription":[]}};</script>'],
  ])('%s yields no Page text', async (_name, html) => {
    expect(await extractVideoText({ document: dom(html), url: WATCH })).toBeNull();
  });

  test('braces inside strings do not end the object early', async () => {
    const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"aaaaaaaaaaa","title":"a } b { c","shortDescription":"d"}};</script>';
    expect((await extractVideoText({ document: dom(html), url: WATCH }))?.text).toBe('a } b { c d');
  });

  test('the description is capped like Page text', async () => {
    const player = { videoDetails: { videoId: 'aaaaaaaaaaa', title: 'Title', shortDescription: 'Wörter '.repeat(5_000) } };
    const result = await extractVideoText({ document: dom(`<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`), url: WATCH });
    expect(new TextEncoder().encode(result!.text).length).toBeLessThanOrEqual(12_000);
  });
});
