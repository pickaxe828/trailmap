/**
 * Forum threads: Reddit (old and new layouts) and Hacker News items (docs/PLAN.md §4.2). Every selector and URL rule
 * for these sites lives here, so a layout change is a one-file fix. None of it is verified against the live sites
 * (see e2e/site/forum/README.md), so every function answers "nothing" when the page is not exactly the expected
 * shape: a wrong capture is worse than none. Readability is never used on a thread, it drops the comments.
 *
 * Privacy: the post and the first comments are kept with their nesting depth. No user name is kept: not an
 * author, and not one quoted inside a comment as a user link or as a plain `u/name` mention.
 */
import { capPageText } from './page-text';

export type ForumSite = 'reddit' | 'hn';
export type ForumText = { text: string; textHash: string };

/** Comments kept, in page order (the sites rank them), and how much of each. */
export const FORUM_MAX_COMMENTS = 40;
export const FORUM_MAX_DEPTH = 6;
const COMMENT_CHARS = 900;
const POST_CHARS = 3_000;
const REMOVED = /^\[(?:deleted|removed|flagged|dead)\]$/i;
export const USER_PLACEHOLDER = '[user]';

const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com']);
const HN_HOST = 'news.ycombinator.com';
const REDDIT_THREAD = /^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/|$)/;

type Thread = { site: ForumSite; id: string };

function threadOf(value: string | undefined): Thread | undefined {
  const url = value ? URL.parse(value) : null;
  if (url?.protocol !== 'https:' || url.username || url.password) return;
  if (REDDIT_HOSTS.has(url.hostname)) {
    const match = REDDIT_THREAD.exec(url.pathname);
    // `/r/u_<name>` is a user profile's own space: user profiles stay denied.
    return match && !match[1]!.toLowerCase().startsWith('u_') ? { site: 'reddit', id: match[2]! } : undefined;
  }
  const id = url.searchParams.get('id');
  return url.hostname === HN_HOST && url.pathname === '/item' && id && /^\d+$/.test(id) ? { site: 'hn', id } : undefined;
}

export const forumSiteOf = (url: string | undefined): ForumSite | undefined => threadOf(url)?.site;
/** A Reddit thread page (`/r/<sub>/comments/<id>/…`), the only part of reddit.com that can ever be recorded. */
export const redditThreadUrl = (url: string | undefined) => threadOf(url)?.site === 'reddit';
/** Any host on reddit.com, for rescreening open tabs when the opt-in changes. */
export const REDDIT_TAB_PATTERNS = ['https://reddit.com/*', 'https://*.reddit.com/*'];

type Entry = { depth: number; text: string };
type Parsed = { title: string; body: string; comments: Entry[] };

const squash = (text: string) => text.replace(/\s+/gu, ' ').trim();
const BLOCKS = 'p, li, pre, blockquote, div, h1, h2, h3, h4, h5, h6, br, tr';

function isUserLink(anchor: Element, base: string): boolean {
  const href = anchor.getAttribute('href');
  const url = href ? URL.parse(href, base) : null;
  if (!url || !(REDDIT_HOSTS.has(url.hostname) || url.hostname === HN_HOST)) return false;
  return /^\/(?:u|user)\//i.test(url.pathname) || (url.pathname === '/user' && url.searchParams.has('id'));
}

/** The visible text of `element`, with every user link and `u/name` mention replaced by a placeholder. */
function readText(element: Element, base: string): string {
  const clone = element.cloneNode(true) as Element;
  for (const anchor of clone.querySelectorAll('a')) {
    if (isUserLink(anchor, base)) anchor.replaceWith(clone.ownerDocument.createTextNode(` ${USER_PLACEHOLDER} `));
  }
  // Buttons are controls ("Read more", "Reply"), never content.
  for (const hidden of clone.querySelectorAll('script, style, template, button, [hidden], .morecomments, .reply, .collapsed')) hidden.remove();
  for (const block of clone.querySelectorAll(BLOCKS)) block.append(' ');
  return squash(squash(clone.textContent ?? '').replace(/(?<![\w/])\/?u\/[\w-]{2,}/giu, USER_PLACEHOLDER));
}

const clip = (text: string, chars: number) => text.length > chars ? `${text.slice(0, chars).trimEnd()}…` : text;
const kept = (text: string) => !!text && !REMOVED.test(text) && text !== USER_PLACEHOLDER;
const children = (element: Element) => Array.from(element.children);

function parseOldReddit(document: Document, id: string): Parsed | undefined {
  const posts = document.querySelectorAll('#siteTable > .thing.link');
  if (posts.length !== 1) return;
  const post = posts[0]!;
  if (post.getAttribute('data-fullname') !== `t3_${id}`) return;
  const entry = children(post).find((child) => child.classList.contains('entry'));
  const title = entry?.querySelector('p.title > a.title');
  if (!entry || !title) return;
  const body = entry.querySelector('.expando .usertext-body .md');
  const comments: Entry[] = [];
  for (const comment of document.querySelectorAll('.commentarea .thing.comment')) {
    const own = children(comment).find((child) => child.classList.contains('entry'))?.querySelector('.usertext-body .md');
    const text = own ? readText(own, document.baseURI) : '';
    if (kept(text)) comments.push({ depth: ancestors(comment, '.thing.comment'), text });
  }
  return { title: readText(title, document.baseURI), body: body ? readText(body, document.baseURI) : '', comments };
}

function ancestors(element: Element, selector: string): number {
  let depth = 0;
  for (let parent = element.parentElement?.closest(selector); parent; parent = parent.parentElement?.closest(selector)) depth++;
  return depth;
}

function parseShreddit(document: Document, id: string): Parsed | undefined {
  const posts = document.querySelectorAll('shreddit-post');
  if (posts.length !== 1) return;
  const post = posts[0]!;
  const postId = post.getAttribute('id') ?? post.getAttribute('post-id');
  if (postId !== `t3_${id}` && postId !== id) return;
  // Live shreddit nests a comment's slots inside `details > div > div`; a slot belongs to its nearest host element.
  const slot = (host: Element, name: string) => Array.from(host.querySelectorAll(`[slot="${name}"]`))
    .find((element) => element.parentElement?.closest(host.localName) === host);
  const title = slot(post, 'title');
  if (!title) return;
  const body = slot(post, 'text-body');
  const comments: Entry[] = [];
  for (const comment of document.querySelectorAll('shreddit-comment')) {
    const own = slot(comment, 'comment');
    const text = own ? readText(own, document.baseURI) : '';
    const attribute = Number(comment.getAttribute('depth'));
    const depth = Number.isInteger(attribute) && attribute >= 0 ? attribute : ancestors(comment, 'shreddit-comment');
    if (kept(text)) comments.push({ depth, text });
  }
  return { title: readText(title, document.baseURI), body: body ? readText(body, document.baseURI) : '', comments };
}

function parseHackerNews(document: Document, id: string): Parsed | undefined {
  const items = document.querySelectorAll('table.fatitem tr.athing');
  if (items.length !== 1 || items[0]!.id !== id) return;
  const title = items[0]!.querySelector('.titleline > a');
  if (!title) return;
  const body = document.querySelector('table.fatitem .toptext');
  const comments: Entry[] = [];
  for (const row of document.querySelectorAll('table.comment-tree tr.athing.comtr')) {
    const text = row.querySelector('.commtext');
    const indent = row.querySelector('td.ind');
    const marked = Number(indent?.getAttribute('indent'));
    const width = Number(indent?.querySelector('img')?.getAttribute('width'));
    const depth = Number.isInteger(marked) && marked >= 0 && indent?.hasAttribute('indent') ? marked
      : Number.isFinite(width) && width >= 0 ? Math.round(width / 40) : undefined;
    const content = text && !text.classList.contains('noshow') ? readText(text, document.baseURI) : '';
    if (depth !== undefined && kept(content)) comments.push({ depth, text: content });
  }
  return { title: readText(title, document.baseURI), body: body ? readText(body, document.baseURI) : '', comments };
}

/** The post and its first comments as plain text, or null when this page is not a recognizable thread for `url`. */
export function extractForumThread(document: Document, url: string): ForumText | null {
  const thread = threadOf(url);
  if (!thread) return null;
  const parsed = thread.site === 'hn' ? parseHackerNews(document, thread.id)
    : (parseOldReddit(document, thread.id) ?? parseShreddit(document, thread.id));
  if (!parsed || !parsed.title) return null;
  const lines = [parsed.title];
  if (parsed.body) lines.push(clip(parsed.body, POST_CHARS));
  const comments = parsed.comments.filter(({ depth }) => depth < FORUM_MAX_DEPTH).slice(0, FORUM_MAX_COMMENTS);
  for (const { depth, text } of comments) lines.push(`${'  '.repeat(depth)}- ${clip(text, COMMENT_CHARS)}`);
  return capPageText(lines.join('\n'));
}
