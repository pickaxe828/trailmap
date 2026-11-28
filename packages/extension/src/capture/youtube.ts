/** YouTube watch pages (docs/PLAN.md §4.1, M4). See e2e/site/youtube/README.md for the unverified page shapes. */
import { capPageText } from './page-text';

const WATCH_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const VIDEO_ID = /^[\w-]{11}$/;
const PLAYER_RESPONSE = 'ytInitialPlayerResponse';

/** The player's `<video>`. The main player first; YouTube also creates preview videos elsewhere on the page. */
export const playerVideo = (document: Document): HTMLVideoElement | null =>
  document.querySelector<HTMLVideoElement>('#movie_player video') ?? document.querySelector<HTMLVideoElement>('video');

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

/** Read only title and description, and only from a response for this video. */
function parsePlayerResponse(text: string, videoId: string): string | null {
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
  if (!isRecord(details) || details.videoId !== videoId ||
      typeof details.title !== 'string' || typeof details.shortDescription !== 'string') return null;
  return `${details.title} ${details.shortDescription}`.replace(/\s+/gu, ' ').trim() || null;
}

type VideoEnvironment = {
  document: Document;
  url: string;
  /** Only supplied after same-document navigation to a different video. A same-origin GET without cookies. */
  fetchWatchHtml?: (url: string) => Promise<string>;
};

export async function extractVideoText({ document, url, fetchWatchHtml }: VideoEnvironment): Promise<ReturnType<typeof capPageText> | null> {
  const videoId = youtubeWatchId(url);
  if (!videoId) return null;
  for (const script of document.scripts) {
    const text = parsePlayerResponse(script.textContent ?? '', videoId);
    if (text) return capPageText(text);
  }
  // The inline response can still belong to the first video. Do not guess from the surrounding DOM.
  if (!fetchWatchHtml) return null;
  try {
    const text = parsePlayerResponse(await fetchWatchHtml(url), videoId);
    return text ? capPageText(text) : null;
  } catch {
    return null;
  }
}
