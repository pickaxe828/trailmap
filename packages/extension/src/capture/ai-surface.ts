import type { AiAnswer } from './google-ai-mode';

/** Where a user types a question and a reply appears: Google AI Mode or one of the opt-in chat sites. */
export type AiSurface = {
  /** Whether this document is currently showing the surface (AI Mode is a mode of one Google document). */
  active(document: Document): boolean;
  /** The composer an input or key event came from, if it came from one. */
  composer(target: EventTarget | null): HTMLElement | undefined;
  formComposer(target: EventTarget | null): HTMLElement | undefined;
  sendComposer(document: Document, target: EventTarget | null): HTMLElement | undefined;
  /** Label of a native follow-up control, read only for an admitted, trusted click. */
  suggestedQuestion?(target: EventTarget | null): string | undefined;
  read(field: HTMLElement): string;
  /** A reply is already being written, so an Enter keypress does not send a turn. */
  busy?(document: Document): boolean;
  /** Replies already on the page. They are history, never claimed by a new question. */
  boundaries(document: Document): Set<Element>;
  /** The one complete reply to `question` not in `excluded`, or `undefined`. `result: null` means an unusable reply. */
  find(document: Document, question: string, excluded: ReadonlySet<Element>): { boundary: Element; result: AiAnswer | null } | undefined;
};
