import { Readability } from '@mozilla/readability';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { PAGE_TEXT_BYTE_LIMIT } from './page-messages';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function hasPasswordField(document: Document): boolean {
  return document.querySelector('input[type="password" i]') !== null;
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
