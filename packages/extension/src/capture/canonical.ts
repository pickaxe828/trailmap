/**
 * A first, deliberately simple canonical URL: no fragment, no tracking
 * parameters. Ticket 08 (filtering) replaces this with `rel=canonical` and
 * session-token handling; the recorder takes it as an option so that swap is
 * one line.
 */
const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid)$/i;

export function canonicalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}
