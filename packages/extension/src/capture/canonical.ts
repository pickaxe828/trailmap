const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|sid|session[-_]?id|phpsessid|jsessionid|aspsessionid[a-z]*)$/i;

/** Resolves a Page's canonical link and removes fragments and tracking or session parameters. */
export function canonicalizeUrl(url: string, canonicalLink?: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (canonicalLink?.trim()) {
    const canonical = URL.parse(canonicalLink, parsed);
    if (canonical && /^https?:$/.test(canonical.protocol) && !canonical.username && !canonical.password) {
      parsed = canonical;
    }
  }

  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/;jsessionid=[^/;]*/gi, '');
  // Kagi private search links carry their session id as a token.
  if (['kagi.com', 'www.kagi.com'].includes(parsed.hostname)) parsed.searchParams.delete('token');
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}
