import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import {
  chooseTrack, extractVideoText, parsePlayerResponse, parseTranscript, transcriptUrl, youtubeWatchId, type CaptionTrack,
} from './youtube';

const site = new URL('../../../../e2e/site/youtube/', import.meta.url);
const read = (name: string) => Bun.file(new URL(name, site)).text();
const WATCH = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const timedtext = async (url: string) => {
  const { searchParams } = new URL(url);
  const name = `timedtext-${searchParams.get('lang')}${searchParams.get('kind') === 'asr' ? '-asr' : ''}.json`;
  return read(name);
};
const dom = async (file: string, url = WATCH) => new JSDOM(await read(file), { url }).window.document;

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

describe('parsePlayerResponse', () => {
  test('reads the inline player response of the matching video', async () => {
    const response = parsePlayerResponse(await read('watch.html'), 'aaaaaaaaaaa');
    expect(response?.title).toBe('Log-structured merge trees explained');
    expect(response?.tracks.map((track) => track.languageCode)).toEqual(['en', 'en', 'de']);
  });
  test('a response for another video is never used', async () => {
    expect(parsePlayerResponse(await read('watch.html'), 'bbbbbbbbbbb')).toBeNull();
  });
  test('a page without captions has a response with no tracks', async () => {
    expect(parsePlayerResponse(await read('watch-no-captions.html'), 'bbbbbbbbbbb')?.tracks).toEqual([]);
  });
  test.each([
    ['no player response', '<html><body>hello</body></html>'],
    ['malformed JSON', '<script>var ytInitialPlayerResponse = {"videoDetails": {;</script>'],
    ['a different shape', '<script>var ytInitialPlayerResponse = {"videoDetails":"nope"};</script>'],
    ['a string holding braces', '<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"aaaaaaaaaaa","title":"}{ \\" }","shortDescription":""},"x":"};"};</script>'],
  ])('%s yields a response or nothing, never a throw', (_name, html) => {
    expect(() => parsePlayerResponse(html, 'aaaaaaaaaaa')).not.toThrow();
  });
  test('braces inside strings do not end the object early', () => {
    const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"aaaaaaaaaaa","title":"a } b { c","shortDescription":"d"}};</script>';
    expect(parsePlayerResponse(html, 'aaaaaaaaaaa')?.title).toBe('a } b { c');
  });
});

describe('chooseTrack', () => {
  const track = (languageCode: string, kind?: 'asr'): CaptionTrack => ({ baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`, languageCode, ...(kind ? { kind } : {}) });
  test('prefers the user language, and a manual track over an automatic one', () => {
    expect(chooseTrack([track('en', 'asr'), track('de'), track('en')], ['de-AT', 'en'])).toEqual(track('de'));
    expect(chooseTrack([track('en', 'asr'), track('en')], ['en-US'])).toEqual(track('en'));
    expect(chooseTrack([track('de'), track('en', 'asr')], ['en'])).toEqual(track('en', 'asr'));
  });
  test('falls back to a manual track, then the first track, and to nothing without tracks', () => {
    expect(chooseTrack([track('fr', 'asr'), track('de')], ['en'])).toEqual(track('de'));
    expect(chooseTrack([track('fr', 'asr'), track('ja', 'asr')], ['en'])).toEqual(track('fr', 'asr'));
    expect(chooseTrack([], ['en'])).toBeUndefined();
  });
});

describe('transcriptUrl', () => {
  const track = (baseUrl: string): CaptionTrack => ({ baseUrl, languageCode: 'en' });
  test('keeps the page origin, asks for json3 and drops nothing else', () => {
    const url = new URL(transcriptUrl(track('https://www.youtube.com/api/timedtext?v=aaaaaaaaaaa&lang=en'), WATCH)!);
    expect(url.origin).toBe('https://www.youtube.com');
    expect(url.searchParams.get('fmt')).toBe('json3');
    expect(url.searchParams.get('lang')).toBe('en');
  });
  test.each([
    'https://evil.test/api/timedtext?lang=en',
    'https://m.youtube.com/api/timedtext?lang=en',
    'http://www.youtube.com/api/timedtext?lang=en',
    'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    'https://www.youtube.com/api/timedtext/../account',
    'javascript:alert(1)',
    'not a url',
  ])('%s is not a same-origin caption request', (baseUrl) => expect(transcriptUrl(track(baseUrl), WATCH)).toBeNull());
});

describe('parseTranscript', () => {
  test('joins the segments of the caption events', async () => {
    expect(parseTranscript(JSON.parse(await read('timedtext-en.json')))).toBe(
      'A log-structured merge tree buffers writes in a memtable. When the memtable fills it is flushed to an immutable SSTable. Compaction merges SSTables so reads touch fewer files.');
  });
  test.each([[null], ['text'], [[]], [{}], [{ events: 'x' }], [{ events: [] }], [{ events: [{ segs: [{ utf8: 7 }] }] }], [{ events: [{ segs: [{ utf8: '  ' }] }] }]])(
    'a different shape (%j) is no transcript', (value) => expect(parseTranscript(value)).toBeNull());
});

describe('extractVideoText', () => {
  const env = (document: Document, over: Partial<Parameters<typeof extractVideoText>[0]> = {}) => ({
    document, url: WATCH, languages: ['en-US'], fetchText: timedtext, ...over,
  });

  test('the transcript of the chosen track is the Page text, with a hash', async () => {
    const result = await extractVideoText(env(await dom('watch.html')));
    expect(result?.source).toBe('transcript');
    expect(result?.text).toContain('Compaction merges SSTables');
    expect(result?.text).not.toContain('Unrelated recommended video');
    expect(result?.text).not.toContain('automatic caption');
    expect(result?.textHash).toBe(new Bun.CryptoHasher('sha256').update(result!.text).digest('hex'));
  });

  test('uses the user language when the video has it', async () => {
    expect((await extractVideoText(env(await dom('watch.html'), { languages: ['de'] })))?.text).toContain('Baum');
  });

  test('the transcript is capped like Page text', async () => {
    const long = JSON.stringify({ events: [{ segs: [{ utf8: 'Wörter '.repeat(5_000) }] }] });
    const result = await extractVideoText(env(await dom('watch.html'), { fetchText: async () => long }));
    expect(new TextEncoder().encode(result!.text).length).toBeLessThanOrEqual(12_000);
  });

  test('makes exactly one request: the caption track of this video', async () => {
    const requests: string[] = [];
    await extractVideoText(env(await dom('watch.html'), { fetchText: async (url) => (requests.push(url), timedtext(url)) }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toStartWith('https://www.youtube.com/api/timedtext?');
  });

  test('without captions it keeps the title and description only', async () => {
    const requests: string[] = [];
    const result = await extractVideoText(env(await dom('watch-no-captions.html', 'https://www.youtube.com/watch?v=bbbbbbbbbbb'), {
      url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', fetchText: async (url) => (requests.push(url), ''),
    }));
    expect(requests).toEqual([]);
    expect(result).toMatchObject({ source: 'description', text: 'Compaction strategies, no captions Leveled versus size-tiered compaction in an LSM tree.' });
  });

  test('a failed or malformed caption request falls back to the description, never to a guess', async () => {
    for (const fetchText of [async () => { throw new Error('offline'); }, async () => 'not json', async () => '{"events":[]}']) {
      const result = await extractVideoText(env(await dom('watch.html'), { fetchText }));
      expect(result?.source).toBe('description');
      expect(result?.text).not.toContain('Unrelated recommended video');
    }
  });

  test('after a single-page navigation the stale inline response is not used: the watch page is fetched once', async () => {
    const stale = await dom('watch.html'); // Still holds the first video's data.
    const next = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
    const requests: string[] = [];
    const result = await extractVideoText(env(stale, {
      url: next,
      fetchText: async (url) => {
        requests.push(url);
        return url === next ? read('watch-no-captions.html') : '';
      },
    }));
    expect(requests).toEqual([next]);
    expect(result).toMatchObject({ source: 'description' });
    expect(result?.text).not.toContain('memtable');
  });

  test('a layout change (no player response anywhere) yields nothing', async () => {
    const document = new JSDOM('<h1>Redesigned</h1><p>Unrelated recommended video</p>', { url: WATCH }).window.document;
    expect(await extractVideoText(env(document, { fetchText: async () => '<html></html>' }))).toBeNull();
  });

  test('not a watch page yields nothing without any request', async () => {
    const requests: string[] = [];
    expect(await extractVideoText(env(await dom('watch.html'), { url: 'https://www.youtube.com/', fetchText: async (url) => (requests.push(url), '') }))).toBeNull();
    expect(requests).toEqual([]);
  });
});
