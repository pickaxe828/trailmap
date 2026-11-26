import { Readability } from '@mozilla/readability';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { PAGE_TEXT_BYTE_LIMIT } from './page-messages';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export function hashText(text: string): string {
  return bytesToHex(sha256(encoder.encode(text)));
}

export function extractPageText(document: Document): { text: string; textHash: string } | null {
  if (hasPasswordField(document)) return null;

  const article = new Readability(document.cloneNode(true) as Document, { serializer: () => '' }).parse();
  const text = article?.textContent?.replace(/\s+/gu, ' ').trim();
  if (!text) return null;

  // Four UTF-8 bytes per token is a rough budget. encodeInto leaves whole code points intact.
  const buffer = new Uint8Array(PAGE_TEXT_BYTE_LIMIT);
  const { written } = encoder.encodeInto(text, buffer);
  const capped = decoder.decode(buffer.subarray(0, written)).trimEnd();
  return { text: capped, textHash: hashText(capped) };
}
