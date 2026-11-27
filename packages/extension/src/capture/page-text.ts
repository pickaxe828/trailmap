import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { PAGE_TEXT_BYTE_LIMIT } from './page-messages';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function hashText(text: string): string {
  return bytesToHex(sha256(encoder.encode(text)));
}

/** Four UTF-8 bytes per token is a rough budget. encodeInto leaves whole code points intact. */
export function capPageText(text: string): { text: string; textHash: string } {
  const buffer = new Uint8Array(PAGE_TEXT_BYTE_LIMIT);
  const { written } = encoder.encodeInto(text, buffer);
  const capped = decoder.decode(buffer.subarray(0, written)).trimEnd();
  return { text: capped, textHash: hashText(capped) };
}
