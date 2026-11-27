/**
 * YouTube watch pages (docs/PLAN.md §4.2, M4). Every selector, JSON path and URL rule for YouTube lives here, so a
 * layout or API change is a one-file fix. None of it is verified against the live site (see e2e/site/youtube/README.md):
 * every function therefore answers "nothing" when the shape is not exactly the expected one. A wrong transcript is
 * worse than none.
 *
 * Data comes only from the page itself: the inline `ytInitialPlayerResponse` (or, after a single-page navigation made
 * it stale, the same-origin HTML of the watch URL, fetched once) and the one same-origin caption request its track
 * lists. The browser runs these in the content script, after the recorder admitted the Visit.
 */
import { capPageText } from './page-text';

const WATCH_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const VIDEO_ID = /^[\w-]{11}$/;
const PLAYER_RESPONSE = 'ytInitialPlayerResponse';
const CAPTION_PATH = '/api/timedtext';

/** The player's `<video>`. The main player first; YouTube also creates preview videos elsewhere on the page. */
export const playerVideo = (document: Document): HTMLVideoElement | null =>
  document.querySelector<HTMLVideoElement>('#movie_player video') ?? document.querySelector<HTMLVideoElement>('video');

export type CaptionTrack = { baseUrl: string; languageCode: string; kind?: 'asr' };
export type PlayerResponse = { title: string; description: string; tracks: CaptionTrack[] };
export type VideoText = { text: string; textHash: string; source: 'transcript' | 'description' };

export function youtubeWatchId(value: string): string | undefined {
  const url = URL.parse(value);
  if (url?.protocol !== 'https:' || !WATCH_HOSTS.has(url.hostname) || url.pathname !== '/watch') return;
  const id = url.searchParams.get('v');
  return id && VIDEO_ID.test(id) ? id : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The JSON object literal that starts at `start` (a `{`), found by matching braces outside strings. */
function objectLiteral(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
}

/** The player response in `text` (a script body or a whole page), only if it is for `videoId`. */
export function parsePlayerResponse(text: string, videoId: string): PlayerResponse | null {
  const at = text.indexOf(PLAYER_RESPONSE);
  if (at < 0) return null;
  const open = /^\s*=\s*\{/.exec(text.slice(at + PLAYER_RESPONSE.length));
  if (!open) return null;
  const literal = objectLiteral(text, at + PLAYER_RESPONSE.length + open[0].length - 1);
  if (!literal) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(literal);
  } catch {
    return null;
  }
  const details = isRecord(parsed) ? parsed.videoDetails : undefined;
  if (!isRecord(details) || details.videoId !== videoId) return null;
  const listed = isRecord(parsed) && isRecord(parsed.captions) && isRecord(parsed.captions.playerCaptionsTracklistRenderer)
    ? parsed.captions.playerCaptionsTracklistRenderer.captionTracks : undefined;
  const tracks: CaptionTrack[] = [];
  for (const item of Array.isArray(listed) ? listed : []) {
    if (!isRecord(item) || typeof item.baseUrl !== 'string' || typeof item.languageCode !== 'string') continue;
    tracks.push({ baseUrl: item.baseUrl, languageCode: item.languageCode, ...(item.kind === 'asr' ? { kind: 'asr' as const } : {}) });
  }
  return {
    title: typeof details.title === 'string' ? details.title : '',
    description: typeof details.shortDescription === 'string' ? details.shortDescription : '',
    tracks,
  };
}

const primary = (language: string) => language.toLowerCase().split('-', 1)[0]!;

/** The user's language first, a manual track over an automatic one, otherwise the first manual, then the first track. */
export function chooseTrack(tracks: CaptionTrack[], languages: readonly string[]): CaptionTrack | undefined {
  const manual = (track: CaptionTrack) => track.kind !== 'asr';
  for (const language of languages.map(primary)) {
    const inLanguage = tracks.filter((track) => primary(track.languageCode) === language);
    const found = inLanguage.find(manual) ?? inLanguage[0];
    if (found) return found;
  }
  return tracks.find(manual) ?? tracks[0];
}

/** The caption request for `track`, only if it is this page's own origin and the caption endpoint. */
export function transcriptUrl(track: CaptionTrack, pageUrl: string): string | null {
  const page = URL.parse(pageUrl);
  const url = URL.parse(track.baseUrl, pageUrl);
  if (!page || url?.protocol !== 'https:' || url.origin !== page.origin || url.pathname !== CAPTION_PATH) return null;
  url.searchParams.set('fmt', 'json3');
  return url.href;
}

/** `json3` caption data: `events[].segs[].utf8`. */
export function parseTranscript(data: unknown): string | null {
  if (!isRecord(data) || !Array.isArray(data.events)) return null;
  const parts: string[] = [];
  for (const event of data.events) {
    if (!isRecord(event) || event.segs === undefined) continue;
    if (!Array.isArray(event.segs)) return null;
    for (const segment of event.segs) {
      if (!isRecord(segment) || typeof segment.utf8 !== 'string') return null;
      parts.push(segment.utf8);
    }
  }
  const text = parts.join(' ').replace(/\s+/gu, ' ').trim();
  return text || null;
}

export type VideoEnvironment = {
  document: Document;
  url: string;
  languages: readonly string[];
  /** A same-origin GET. The content script's implementation sends no cookies. */
  fetchText: (url: string) => Promise<string>;
};

async function playerResponse({ document, url, fetchText }: VideoEnvironment, videoId: string): Promise<PlayerResponse | null> {
  for (const script of document.scripts) {
    const found = parsePlayerResponse(script.textContent ?? '', videoId);
    if (found) return found;
  }
  // The inline data belongs to the first video loaded in this tab; a single-page navigation leaves it stale.
  try {
    return parsePlayerResponse(await fetchText(url), videoId);
  } catch {
    return null;
  }
}

/** The transcript, or the title and description when there is none, or null when nothing trustworthy is on the page. */
export async function extractVideoText(env: VideoEnvironment): Promise<VideoText | null> {
  const videoId = youtubeWatchId(env.url);
  if (!videoId) return null;
  const response = await playerResponse(env, videoId);
  if (!response) return null;

  const track = chooseTrack(response.tracks, env.languages);
  const url = track && transcriptUrl(track, env.url);
  if (url) {
    try {
      const transcript = parseTranscript(JSON.parse(await env.fetchText(url)));
      if (transcript) return { ...capPageText(transcript), source: 'transcript' };
    } catch {
      // Fall through to the description.
    }
  }
  const text = `${response.title} ${response.description}`.replace(/\s+/gu, ' ').trim();
  return text ? { ...capPageText(text), source: 'description' } : null;
}
