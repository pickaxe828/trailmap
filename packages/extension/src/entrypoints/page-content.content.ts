import { extractPageText, hasPasswordField, hashText, screenableRoots } from '../capture/extract';
import { PAGE_CONTENT_MESSAGE, type PageContent, type PageContentMessage, type PageContentReply } from '../capture/page-messages';
import { googleSearchSurface } from '../capture/search';
import { watchAiMode } from '../capture/watch-ai-mode';

const EXTRACTION_DELAY_MS = 2_000;
const SCROLL_INTERVAL_MS = 250;
const SELECTION_DELAY_MS = 250;
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

function canonicalLink(): string | undefined {
  const href = document.querySelector('link[rel~="canonical" i][href]')?.getAttribute('href');
  return href?.trim() ? URL.parse(href, document.baseURI)?.href : undefined;
}

function send(content: PageContent): Promise<PageContentReply | undefined> {
  const message: PageContentMessage = { type: PAGE_CONTENT_MESSAGE, pageUrl: location.href, ...content };
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

function selectedText(): string {
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd, value } = focused;
    if (selectionStart !== null && selectionEnd !== null) return value.slice(selectionStart, selectionEnd).trim();
  }
  return window.getSelection()?.toString().trim() ?? '';
}

function isHighlight(text: string): boolean {
  let count = 0;
  for (const segment of words.segment(text)) {
    if (segment.isWordLike && ++count === 3) return true;
  }
  return false;
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  main(ctx) {
    const shadowOf = (element: Element) => element.shadowRoot ?? (element.namespaceURI === 'http://www.w3.org/1999/xhtml'
      ? chrome.dom?.openOrClosedShadowRoot(element as HTMLElement) ?? null : null);
    const findPassword = () => hasPasswordField(document, shadowOf);

    function watchPasswordFields(check: () => void, enabled: () => boolean) {
      const watched = new WeakSet<Document | ShadowRoot>();
      const observer = new MutationObserver(rescreen);
      function watch(root: Document | ShadowRoot) {
        if (watched.has(root)) return;
        watched.add(root);
        observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['type'] });
      }
      function rescreen() {
        if (!enabled()) return;
        for (const root of screenableRoots(document, shadowOf)) watch(root);
        check();
      }
      watch(document);
      ctx.addEventListener(document, 'load', rescreen, { capture: true });
      // attachShadow() on an existing host produces no light-DOM mutation.
      ctx.setInterval(rescreen, EXTRACTION_DELAY_MS);
      ctx.onInvalidated(() => observer.disconnect());
      rescreen();
    }

    if (window !== window.top) {
      // A child frame can veto capture, but can never publish metadata or text.
      let detected = false;
      watchPasswordFields(() => {
        if (findPassword()) {
          detected = true;
          void send({ kind: 'screen', hasPassword: true });
        }
      }, () => !detected);
      return;
    }

    let extractionTimer: number | undefined;
    let scrollTimer: number | undefined;
    let selectionTimer: number | undefined;
    let screenTimer: number | undefined;
    let admitted = false;
    let passwordDetected = false;
    let generation = 0;
    let url = location.href.split('#', 1)[0]!;
    let lastSelection = '';
    let maxDepth = 0;
    let reportedDepth = 0;

    const screen = async (started: number) => {
      if (document.readyState === 'loading' || passwordDetected || generation !== started) return;
      passwordDetected = findPassword();
      const reply = await send({ kind: 'screen', hasPassword: passwordDetected });
      if (generation === started && !passwordDetected) {
        admitted = !!reply;
        if (reply?.aiPending?.length) aiMode.resume(reply.aiPending);
      }
    };

    const isPublic = () => {
      if (!passwordDetected && findPassword()) {
        passwordDetected = true;
        admitted = false;
        void send({ kind: 'screen', hasPassword: true });
      }
      return admitted && !passwordDetected;
    };

    const aiMode = watchAiMode(document, isPublic, send);
    ctx.onInvalidated(() => aiMode.dispose());

    const capture = async (started: number) => {
      if (!document.body) return;
      if (!admitted) await screen(started);
      if (generation !== started || !isPublic() || googleSearchSurface(location.href)) return;
      const sourceHash = hashText(document.documentElement.outerHTML);
      const reply = await send({ kind: 'probe', sourceHash, canonicalLink: canonicalLink() });
      if (!reply?.extract || generation !== started || !isPublic()) return;

      // The DOM may have changed while the service worker looked up the Page.
      const latestHash = hashText(document.documentElement.outerHTML);
      const article = extractPageText(document);
      if (article) {
        await send({ kind: 'text', visitId: reply.visitId, ...article, sourceHash: latestHash });
      }
    };

    const reportScroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = undefined;
      if (maxDepth <= reportedDepth || !isPublic()) return;
      reportedDepth = maxDepth;
      void send({ kind: 'scroll', depth: maxDepth });
    };

    const trackScroll = () => {
      const root = document.scrollingElement;
      if (!root) return;
      const scrollable = root.scrollHeight - root.clientHeight;
      if (scrollable <= 0) return;

      maxDepth = Math.max(maxDepth, Math.min(1, root.scrollTop / scrollable));
      if (maxDepth > reportedDepth && scrollTimer === undefined) {
        scrollTimer = ctx.setTimeout(reportScroll, SCROLL_INTERVAL_MS);
      }
    };

    const schedule = () => {
      clearTimeout(extractionTimer);
      clearTimeout(scrollTimer);
      clearTimeout(selectionTimer);
      clearTimeout(screenTimer);
      scrollTimer = undefined;
      maxDepth = reportedDepth = 0;
      lastSelection = '';
      admitted = passwordDetected = false;
      trackScroll();
      const started = ++generation;
      // Let the browser report the committed navigation (including pushState)
      // and the page render before screening. Extraction retries if necessary.
      screenTimer = ctx.setTimeout(() => {
        void screen(started).then(() => {
          if (generation === started) reportScroll();
        });
      }, 0);
      extractionTimer = ctx.setTimeout(() => void capture(started).catch(() => undefined), EXTRACTION_DELAY_MS);
    };

    if (document.readyState !== 'loading') schedule();
    else ctx.addEventListener(document, 'DOMContentLoaded', schedule, { once: true });

    // Catch login forms inserted after the initial screen without observing or
    // reading form values. Also check synchronously before each content capture.
    watchPasswordFields(isPublic, () => admitted && !passwordDetected);
    ctx.addEventListener(window, 'pageshow', (event) => {
      if (event.persisted) schedule();
    });
    ctx.addEventListener(window, 'pagehide', reportScroll);
    ctx.addEventListener(window, 'scroll', trackScroll, { passive: true });
    ctx.addEventListener(window, 'scrollend', reportScroll);
    ctx.addEventListener(document, 'selectionchange', () => {
      clearTimeout(selectionTimer);
      selectionTimer = ctx.setTimeout(() => {
        if (googleSearchSurface(location.href) || !isPublic()) return;
        const text = selectedText();
        if (text && text !== lastSelection) {
          void send(isHighlight(text)
            ? { kind: 'highlight', source: 'selection', text, canonicalLink: canonicalLink() }
            : { kind: 'selection' });
        }
        lastSelection = text;
      }, SELECTION_DELAY_MS);
    }, { capture: true });
    ctx.addEventListener(window, 'copy', (event) => {
      if (!event.isTrusted || googleSearchSurface(location.href) || !isPublic()) return;
      const text = event.clipboardData?.getData('text/plain').trim() || selectedText();
      if (text) void send({ kind: 'highlight', source: 'copy', text, canonicalLink: canonicalLink() });
    });

    window.navigation?.addEventListener('currententrychange', () => {
      const currentUrl = location.href.split('#', 1)[0]!;
      if (currentUrl === url) return;
      const sameMode = googleSearchSurface(url) === 'ai-mode' && googleSearchSurface(currentUrl) === 'ai-mode';
      url = currentUrl;
      if (sameMode) return;
      aiMode.clear();
      schedule();
    });
  },
});
