import { describe, expect, test } from 'bun:test';
import { CHAT_SITES, chatConversationSite, chatConversationUrl, chatSiteOf, sameChatConversation } from '../capture/chat-sites';
import { chatCaptureAllowed, maySendToModel, recordingState, siteKey } from './policy';

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

describe('opt-in conversation capture from Gemini, ChatGPT and Claude', () => {
  const on = { paused: false, skippedHosts: [], chatCapture: { chatgpt: true } };
  const off = { paused: false, skippedHosts: [] };
  const conversation = (site: 'chatgpt' | 'claude' | 'gemini') => chatConversationUrl(site, 'v1');

  test('is off by default: no chat page and no conversation is recordable', () => {
    for (const site of ['chatgpt', 'claude', 'gemini'] as const) {
      expect(recordingState(conversation(site), off)).toBe('skipped');
      expect(chatCaptureAllowed(`https://${CHAT_SITES[site].host}/`, off)).toBe(false);
      expect(chatCaptureAllowed(`https://${CHAT_SITES[site].host}/`, { ...off, chatCapture: { [site]: false } })).toBe(false);
    }
  });

  test('is per site and never makes the real chat page itself recordable', () => {
    expect(chatCaptureAllowed('https://chatgpt.com/c/abc', on)).toBe(true);
    expect(chatCaptureAllowed('https://claude.ai/new', on)).toBe(false);
    expect(chatCaptureAllowed('https://gemini.google.com/app', on)).toBe(false);
    expect(recordingState('https://chatgpt.com/c/abc', on)).toBe('skipped');
    expect(recordingState(conversation('chatgpt'), on)).toBe('recording');
    expect(recordingState(conversation('claude'), on)).toBe('skipped');
    expect(recordingState('https://chatgpt.com/.trailmap-chat/v1', { ...on, chatCapture: {} })).toBe('skipped');
  });

  test('pause, the skip list, look-alike hosts and non-HTTPS pages still win', () => {
    expect(recordingState(conversation('chatgpt'), { ...on, paused: true })).toBe('paused');
    expect(chatCaptureAllowed('https://chatgpt.com/', { ...on, paused: true })).toBe(false);
    expect(recordingState(conversation('chatgpt'), { ...on, skippedHosts: ['chatgpt.com'] })).toBe('skipped');
    expect(chatCaptureAllowed('https://chatgpt.com/', { ...on, skippedHosts: ['chatgpt.com'] })).toBe(false);
    expect(chatCaptureAllowed('https://chatgpt.com.evil.test/', on)).toBe(false);
    expect(chatCaptureAllowed('https://docs.chatgpt.com/', on)).toBe(false);
    expect(chatCaptureAllowed('http://chatgpt.com/', on)).toBe(false);
    expect(chatCaptureAllowed('https://user:pw@chatgpt.com/', on)).toBe(false);
  });

  test('a conversation reaches a model only while its site stays opted in', () => {
    const url = conversation('chatgpt');
    const visit = { url, canonicalUrl: url, engagement: 'skimmed' as const, aiConversation: true as const };
    const page = { canonicalUrl: url, sourceUrl: url, text: 'User question: why?', aiTurns: [{ id: 't', question: 'why?', answer: 'Because.', citations: [] }] };
    expect(maySendToModel(visit, page, on)).toBe(true);
    expect(maySendToModel(visit, page, off)).toBe(false);
    expect(maySendToModel(visit, page, { ...on, paused: true })).toBe(false);
    expect(maySendToModel(visit, page, { ...on, skippedHosts: ['chatgpt.com'] })).toBe(false);
  });

  test('conversation URLs identify only the site they belong to', () => {
    expect(chatSiteOf('https://chatgpt.com/c/1')).toBe('chatgpt');
    expect(chatSiteOf('https://gemini.google.com/app/1')).toBe('gemini');
    expect(chatSiteOf('https://claude.ai/chat/1')).toBe('claude');
    expect(chatSiteOf('https://www.google.com/')).toBeUndefined();
    expect(chatConversationSite('https://chatgpt.com/.trailmap-chat/x')).toBe('chatgpt');
    expect(chatConversationSite('https://chatgpt.com/c/1')).toBeUndefined();
    expect(sameChatConversation('https://chatgpt.com/', 'https://chatgpt.com/c/1')).toBe(true);
    expect(sameChatConversation('https://chatgpt.com/c/1', 'https://chatgpt.com/c/2')).toBe(false);
    expect(sameChatConversation('https://claude.ai/new', 'https://claude.ai/chat/1')).toBe(true);
    expect(sameChatConversation('https://gemini.google.com/app', 'https://gemini.google.com/app/1')).toBe(true);
    expect(sameChatConversation('https://chatgpt.com/', 'https://claude.ai/chat/1')).toBe(false);
  });
});
