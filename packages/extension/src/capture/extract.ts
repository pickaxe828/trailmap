import { Readability } from '@mozilla/readability';
import { capPageText, hashText } from './page-text';

export { hashText };

type ShadowOf = (element: Element) => ShadowRoot | null;
const openShadow: ShadowOf = (element) => element.shadowRoot;

export function* screenableRoots(root: Document | ShadowRoot, shadowOf: ShadowOf = openShadow): Generator<Document | ShadowRoot> {
  yield root;
  for (const element of root.querySelectorAll('*')) {
    const shadow = shadowOf(element);
    if (shadow) yield* screenableRoots(shadow, shadowOf);
    if (element.localName === 'iframe' || element.localName === 'frame') {
      const frame = (element as HTMLIFrameElement).contentDocument;
      if (frame) yield* screenableRoots(frame, shadowOf);
    }
  }
}

export function hasPasswordField(document: Document, shadowOf?: ShadowOf): boolean {
  for (const root of screenableRoots(document, shadowOf)) {
    if (root.querySelector('input[type="password" i]')) return true;
  }
  return false;
}

export function extractPageText(document: Document): { text: string; textHash: string } | null {
  if (hasPasswordField(document)) return null;

  const article = new Readability(document.cloneNode(true) as Document, { serializer: () => '' }).parse();
  const text = article?.textContent?.replace(/\s+/gu, ' ').trim();
  if (!text) return null;

  return capPageText(text);
}
