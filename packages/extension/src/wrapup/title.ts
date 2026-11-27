/** IPA Extensions and Spacing Modifier Letters: letter-class characters that are symbols, not words. */
const SYMBOL_LETTERS = /[ɐ-˿]/g;
const WORD = /[\p{Ll}\p{Lu}\p{Lt}\p{Lo}]{2,}/u;

/** A title is readable when it holds at least one word (two or more letters), not just symbols such as ˤ, ʕ or ʔ. */
export const hasReadableWords = (title: string) => WORD.test(title.replace(SYMBOL_LETTERS, ' '));

/**
 * Keeps a worded title. A symbol-only title gets the first fallback that has words appended
 * (driving question, then first search text), so the symbol is always shown with something readable.
 */
export function guardTitle(title: string, fallbacks: readonly string[]): string {
  if (hasReadableWords(title)) return title;
  const fallback = fallbacks.map((text) => text.replace(/\s+/g, ' ').trim()).find(hasReadableWords);
  return `${title.trim()}: ${fallback ?? 'untitled research'}`;
}
