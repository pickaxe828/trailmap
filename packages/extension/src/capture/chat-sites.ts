/**
 * The chat assistants whose conversations can be captured, only after the user opts in per site
 * (docs/PLAN.md §4.1, §4.2). Their hosts stay on the default deny-list: opting in never makes the
 * page itself recordable, only the conversation turns the user types here.
 */
export type ChatSite = 'gemini' | 'chatgpt' | 'claude';

export const CHAT_SITES: Record<ChatSite, { label: string; host: string; newChatPath: string }> = {
  gemini: { label: 'Gemini', host: 'gemini.google.com', newChatPath: '/app' },
  chatgpt: { label: 'ChatGPT', host: 'chatgpt.com', newChatPath: '/' },
  claude: { label: 'Claude', host: 'claude.ai', newChatPath: '/new' },
};
export const CHAT_SITE_IDS = Object.keys(CHAT_SITES) as ChatSite[];
export type ChatCaptureSettings = Partial<Record<ChatSite, boolean>>;

// A path, not a fragment: stored Visit URLs drop fragments, and both URLs of a conversation must carry the key.
const PREFIX = '/.trailmap-chat/';
const pathOf = (url: URL) => url.pathname.replace(/\/+$/, '') || '/';

/** The site exactly (no subdomains, HTTPS only), whatever the path. */
export function chatSiteOf(value: string | undefined): ChatSite | undefined {
  const url = value ? URL.parse(value) : null;
  if (url?.protocol !== 'https:') return;
  const host = url.hostname.toLowerCase();
  return CHAT_SITE_IDS.find((site) => CHAT_SITES[site].host === host);
}

/** A local, per-conversation key on the real host. It never carries the chat's own URL or id. */
export const chatConversationUrl = (site: ChatSite, id: string) => `https://${CHAT_SITES[site].host}${PREFIX}${id}`;

export function chatConversationSite(value: string | undefined): ChatSite | undefined {
  const site = chatSiteOf(value);
  return site && URL.parse(value!)?.pathname.startsWith(PREFIX) ? site : undefined;
}

export const chatPath = (value: string) => { const url = URL.parse(value); return url ? pathOf(url) : ''; };

/** A new chat's first message moves the page to its own conversation URL; that is not a new conversation. */
export function sameChatConversation(from: string, to: string): boolean {
  const site = chatSiteOf(from);
  return !!site && chatSiteOf(to) === site && chatPath(from) === CHAT_SITES[site].newChatPath &&
    chatPath(to) !== CHAT_SITES[site].newChatPath;
}

export function isNewChatUrl(value: string): boolean {
  const site = chatSiteOf(value);
  return !!site && chatPath(value) === CHAT_SITES[site].newChatPath;
}
