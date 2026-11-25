import { expect, test } from 'bun:test';
import { maySendToModel, recordingState, siteKey } from './policy';

const settings = { paused: false, skippedHosts: ['study.test'] };

test.each([
  ['https://MAIL.google.com.:8443/inbox', 'skipped'],
  ['https://chase.com/', 'skipped'],
  ['https://calendar.google.com/', 'skipped'],
  ['https://discord.com/channels', 'skipped'],
  ['https://www.instagram.com/', 'skipped'],
  ['https://auth.openai.com/authorize', 'skipped'],
  ['https://study.test:443/', 'skipped'],
  ['https://docs.study.test/path', 'skipped'],
  ['https://notstudy.test/path', 'recording'],
  ['https://calendar.google.com.learn.test/', 'skipped'],
  ['https://chase.com.learn.test/', 'recording'],
  ['https://www.google.com/search?q=mail', 'recording'],
  ['https://www.youtube.com/results?search_query=crdt', 'recording'],
  ['http://localhost:4173/', 'skipped'],
  ['http://db.localhost/', 'skipped'],
  ['http://server/', 'skipped'],
  ['http://my-nas.home.arpa/', 'skipped'],
  ['http://0x7f000001:4173/', 'skipped'],
  ['http://10.0.0.0/', 'skipped'],
  ['http://172.31.255.255/', 'skipped'],
  ['http://172.32.0.0/', 'recording'],
  ['http://192.168.255.255/', 'skipped'],
  ['http://169.254.2.3/', 'skipped'],
  ['http://100.127.0.1/', 'skipped'],
  ['http://[::1]/', 'skipped'],
  ['http://[::ffff:192.168.1.2]/', 'skipped'],
  ['http://[fd00::1]/', 'skipped'],
  ['http://[fe80::1]/', 'skipped'],
  ['http://[2606:4700::1111]/', 'recording'],
  ['http://learn.test:4173/trail/start.html', 'recording'],
  ['https://shop.test/en/Checkout/session/', 'skipped'],
  ['https://shop.test/%63heckout.html', 'skipped'],
  ['https://shop.test/cart%2Fcheckout;session=42', 'skipped'],
  ['https://shop.test/guide/checkout-tutorial', 'recording'],
  ['chrome://settings/', 'skipped'],
  ['not a URL', 'skipped'],
] as const)('evaluates %s as %s without resolving DNS', (url, expected) => {
  expect(recordingState(url, settings)).toBe(expected);
});

test('pause takes priority and site identity ignores port, scheme and case', () => {
  expect(recordingState('https://mail.google.com/', { ...settings, paused: true })).toBe('paused');
  expect(siteKey('https://Docs.Study.test.:8443/a')).toBe('docs.study.test');
});

test('only sends text belonging to an engaged Visit that is still allowed', () => {
  const page = { canonicalUrl: 'https://learn.test/article', sourceUrl: 'https://learn.test/article', text: 'Article text' };
  const visit = { url: 'https://learn.test/article?utm_source=trail', canonicalUrl: page.canonicalUrl, engagement: 'skimmed' as const };
  expect(maySendToModel(visit, page, settings)).toBe(true);
  expect(maySendToModel({ ...visit, engagement: 'bounced' }, page, settings)).toBe(false);
  expect(maySendToModel({ ...visit, url: 'https://study.test/article' }, page, settings)).toBe(false);
  const skippedPage = { ...page, canonicalUrl: 'https://study.test/article' };
  expect(maySendToModel({ ...visit, canonicalUrl: skippedPage.canonicalUrl }, skippedPage, settings)).toBe(false);
  expect(maySendToModel(visit, skippedPage, settings)).toBe(false);
  expect(maySendToModel(visit, { ...page, text: '' }, settings)).toBe(false);
  expect(maySendToModel(visit, { ...page, sourceUrl: 'https://study.test/article' }, settings)).toBe(false);
  expect(maySendToModel(visit, { ...page, sourceUrl: undefined }, settings)).toBe(false);
  expect(maySendToModel({ ...visit, privacyBlocked: true }, page, settings)).toBe(false);
  expect(maySendToModel(visit, page, { ...settings, paused: true })).toBe(false);
});
