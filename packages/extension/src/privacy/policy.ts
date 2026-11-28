import type { Page, Visit } from '@trailmap/shared';
import { chatConversationSite, chatSiteOf, type ChatCaptureSettings, type ChatSite } from '../capture/chat-sites';
import { redditThreadUrl } from '../capture/forum';
import { googleSearchSurface } from '../capture/search';
import { DENIED_HOSTS, DENIED_PATH_SEGMENTS, DENIED_SERVICE_LABELS, LOCAL_SUFFIXES } from './default-deny-list';

export type RecordingSettings = {
  paused: boolean;
  skippedHosts: string[];
  expeditionInactivityMinutes?: number;
  topicSwitchMinutes?: number;
  /** "Use my notes to build concepts and threads". On unless it is explicitly false. */
  useMyNotes?: boolean;
  /** "Capture conversations from Gemini / ChatGPT / Claude". Off unless a site is explicitly true. */
  chatCapture?: ChatCaptureSettings;
  /** "Capture Reddit thread pages". Off unless true. Feeds, profiles, the inbox and settings stay denied either way. */
  redditThreads?: boolean;
};
export const usesMyNotes = ({ useMyNotes }: Pick<RecordingSettings, 'useMyNotes'>) => useMyNotes !== false;
export type RecordingState = 'recording' | 'paused' | 'skipped';

const hostname = (url: URL) => url.hostname.toLowerCase().replace(/\.+$/, '');
const matchesHost = (host: string, rule: string) => host === rule || host.endsWith(`.${rule}`);
const webUrl = (url: string | undefined) => url && URL.parse(url);

/** A site entry covers this hostname and its subdomains, regardless of scheme or port. */
export function siteKey(url: string | undefined): string | undefined {
  const parsed = webUrl(url);
  if (parsed && ['http:', 'https:'].includes(parsed.protocol)) return hostname(parsed);
}

function isPrivateHost(host: string): boolean {
  if (host.startsWith('[')) {
    // Allow global IPv6 unicast only. This excludes loopback, link-local,
    // unique-local and IPv4-mapped forms. Also exclude IPv6 transition ranges.
    return !/^\[[23][a-f0-9]{3}:/.test(host) || /^\[(2001:0?:|2002:)/.test(host);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    // URL has already normalised hex, octal and shortened IPv4 spellings.
    const [a = 0, b = 0] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  return !host.includes('.') || LOCAL_SUFFIXES.some((suffix) => matchesHost(host, suffix));
}

/**
 * The default deny-list. With `redditThreads` (the user's opt-in), a Reddit thread page `/r/<sub>/comments/<id>/…` is the one
 * address on reddit.com that is not denied; everything else there, and every other rule, still applies.
 */
export function isDefaultDenied(url: string | undefined, { redditThreads }: Pick<RecordingSettings, 'redditThreads'> = {}): boolean {
  const parsed = webUrl(url);
  const host = siteKey(url);
  if (!parsed || !host || parsed.username || parsed.password || isPrivateHost(host)) return true;
  const optedInThread = redditThreads === true && redditThreadUrl(url);
  if (DENIED_HOSTS.some((rule) => matchesHost(host, rule) && !(optedInThread && rule === 'reddit.com')) ||
    DENIED_SERVICE_LABELS.includes(host.split('.')[0] ?? '')) return true;

  // Match whole path segments, including common extensions and matrix parameters.
  const path = parsed.pathname.toLowerCase().replace(/%([a-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return path.split(/[/\\]/).some((segment) => DENIED_PATH_SEGMENTS.includes(segment.split(/[.;]/)[0] ?? ''));
}

export const chatCaptureEnabled = (settings: Pick<RecordingSettings, 'chatCapture'>, site: ChatSite) => settings.chatCapture?.[site] === true;

const skippedByUser = (host: string, settings: RecordingSettings) => settings.skippedHosts.some((rule) => matchesHost(host, rule));

/**
 * May the conversation typed on this real chat page be captured? Only for an opted-in site that is not
 * paused or skipped. This is the one gate; it never makes the page's own content recordable.
 */
export function chatCaptureAllowed(url: string | undefined, settings: RecordingSettings): boolean {
  const site = chatSiteOf(url);
  const parsed = site && URL.parse(url!);
  return !!parsed && !settings.paused && chatCaptureEnabled(settings, site) && !parsed.username && !parsed.password &&
    !skippedByUser(parsed.hostname.toLowerCase(), settings);
}

/** Captured conversations survive a deny-list purge only while their site stays opted in and unskipped. */
export function chatConversationRetained(url: string | undefined, settings: RecordingSettings | undefined): boolean {
  const site = chatConversationSite(url);
  return !!settings && !!site && chatCaptureEnabled(settings, site) && !skippedByUser(siteKey(url)!, settings);
}

export function recordingState(url: string | undefined, settings: RecordingSettings): RecordingState {
  if (settings.paused) return 'paused';
  // The synthetic key of a captured conversation is the only chat URL that can be recordable.
  if (chatConversationSite(url)) return chatConversationRetained(url, settings) ? 'recording' : 'skipped';
  const host = siteKey(url);
  return !host || isDefaultDenied(url, settings) || settings.skippedHosts.some((rule) => matchesHost(host, rule))
    ? 'skipped'
    : 'recording';
}

type VisitMetadata = Pick<Visit, 'url' | 'canonicalUrl' | 'privacyBlocked'>;

/** A navigation title or query may be used only from a recordable Visit. */
export function eligibleMetadata<T extends VisitMetadata>(visit: T | undefined, settings: RecordingSettings): visit is T {
  return !!visit && !visit.privacyBlocked && recordingState(visit.url, settings) === 'recording' &&
    recordingState(visit.canonicalUrl, settings) === 'recording';
}

/** Call at dispatch time with current settings, not just when enqueuing enrichment. */
export function maySendToModel(
  visit: Pick<Visit, 'url' | 'canonicalUrl' | 'engagement' | 'privacyBlocked' | 'aiConversation'>,
  page: Pick<Page, 'canonicalUrl' | 'sourceUrl' | 'sourceVisitId' | 'text' | 'aiTurns'> | undefined,
  settings: RecordingSettings,
  sourceVisit?: Visit,
): boolean {
  if (visit.aiConversation) {
    if (!page?.aiTurns?.some(({ answer }) => !!answer) || page.aiTurns.some(({ answer, extractionFailed }) => !answer && !extractionFailed)) return false;
  } else if ([visit.url, visit.canonicalUrl, page?.sourceUrl].some((url) => url && googleSearchSurface(url))) {
    return false;
  }
  const knownSource = !page?.sourceVisitId || (sourceVisit?.id === page.sourceVisitId && eligibleMetadata(sourceVisit, settings));
  return knownSource && eligibleMetadata(visit, settings) && visit.engagement !== 'bounced' && !!page?.text.trim() &&
    page.canonicalUrl === visit.canonicalUrl && recordingState(page.sourceUrl, settings) === 'recording';
}
