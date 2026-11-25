// Google publishes its Search domains at https://www.google.com/supported_domains.
const googleSuffixes = new Set(`
  com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be bf bg com.bh bi bj
  com.bn com.bo com.br bs bt co.bw by com.bz ca cd cf cg ch ci co.ck cl cm cn com.co co.cr com.cu cv
  com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg com.gh com.gi
  gl gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je com.jm jo co.jp co.ke
  com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv com.ly co.ma md me mg mk ml com.mm mn
  com.mt mu mv mw com.mx com.my co.mz com.na com.ng com.ni ne nl no com.np nr nu co.nz com.om com.pa
  com.pe com.pg com.ph com.pk pl pn com.pr ps pt com.py com.qa ro ru rw com.sa com.sb sc se com.sg sh
  si sk com.sl sn so sm sr st com.sv td tg co.th com.tj tl tm tn to com.tr tt com.tw co.tz com.ua
  co.ug co.uk com.uy co.uz com.vc co.ve co.vi com.vn vu ws rs co.za co.zm co.zw cat
`.trim().split(/\s+/));

type SearchQuery = { engine: string; q: string };

export function parseSearchQuery(value: string): SearchQuery | null {
  const url = URL.parse(value);
  if (!url || !/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.replace(/\/$/, '') || '/';
  const q = url.searchParams.get('q')?.trim();

  if (path === '/search' && q) {
    if (host.startsWith('google.') && googleSuffixes.has(host.slice('google.'.length))) return { engine: 'google', q };
    if (host === 'bing.com' || host === 'cn.bing.com') return { engine: 'bing', q };
    if (host === 'kagi.com') return { engine: 'kagi', q };
  }
  if (q && /^(?:(?:html|lite|safe|noai|safe-noai)\.)?duckduckgo\.com$/.test(host)
      && ['/', '/html', '/lite'].includes(path)) {
    return { engine: 'duckduckgo', q };
  }
  if ((host === 'youtube.com' || host === 'm.youtube.com') && path === '/results') {
    const q = url.searchParams.get('search_query')?.trim();
    return q ? { engine: 'youtube', q } : null;
  }
  if (/^(?:[a-z0-9-]+\.(?:m\.)?)?wikipedia\.org$/.test(host)) {
    const title = url.searchParams.get('title');
    if (path === '/wiki/Special:Search' || (path === '/w/index.php' && (!title || title === 'Special:Search'))) {
      const q = url.searchParams.get('search')?.trim();
      return q ? { engine: 'wikipedia', q } : null;
    }
    const prefix = '/wiki/Special:Search/';
    if (path.startsWith(prefix)) {
      try {
        const q = decodeURIComponent(path.slice(prefix.length)).replaceAll('_', ' ').trim();
        return q ? { engine: 'wikipedia', q } : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
