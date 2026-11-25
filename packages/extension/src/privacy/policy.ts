import type { Page, Visit } from '@trailmap/shared';
import { DENIED_HOSTS, DENIED_PATH_SEGMENTS, DENIED_SERVICE_LABELS, LOCAL_SUFFIXES } from './default-deny-list';

export type RecordingSettings = { paused: boolean; skippedHosts: string[] };
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

export function isDefaultDenied(url: string | undefined): boolean {
  const parsed = webUrl(url);
  const host = siteKey(url);
  if (!parsed || !host || parsed.username || parsed.password || isPrivateHost(host)) return true;
  if (DENIED_HOSTS.some((rule) => matchesHost(host, rule)) ||
    DENIED_SERVICE_LABELS.includes(host.split('.')[0] ?? '')) return true;

  // Match whole path segments, including common extensions and matrix parameters.
  const path = parsed.pathname.toLowerCase().replace(/%([a-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return path.split(/[/\\]/).some((segment) => DENIED_PATH_SEGMENTS.includes(segment.split(/[.;]/)[0] ?? ''));
}

export function recordingState(url: string | undefined, settings: RecordingSettings): RecordingState {
  if (settings.paused) return 'paused';
  const host = siteKey(url);
  return !host || isDefaultDenied(url) || settings.skippedHosts.some((rule) => matchesHost(host, rule))
    ? 'skipped'
    : 'recording';
}

/** Call at dispatch time with current settings, not just when enqueuing enrichment. */
export function maySendToModel(
  visit: Pick<Visit, 'url' | 'canonicalUrl' | 'engagement' | 'privacyBlocked'>,
  page: Pick<Page, 'canonicalUrl' | 'sourceUrl' | 'text'> | undefined,
  settings: RecordingSettings,
): boolean {
  return !visit.privacyBlocked && (visit.engagement === 'skimmed' || visit.engagement === 'read') && !!page?.text.trim() &&
    page.canonicalUrl === visit.canonicalUrl && recordingState(visit.url, settings) === 'recording' &&
    recordingState(page.canonicalUrl, settings) === 'recording' && recordingState(page.sourceUrl, settings) === 'recording';
}
