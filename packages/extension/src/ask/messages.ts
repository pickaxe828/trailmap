export const ASK_MESSAGE = 'trailmap.ask';
export const MAX_ASK_QUESTION = 300;
export const NOTHING_IN_YOUR_TRAILS = 'Nothing in your trails answers this.';

/** A source the answer rests on: always something that was actually sent. Chat conversations have no address of their own. */
export type AskCitation = { kind: 'page' | 'expedition'; id: string; title: string; href?: string };

export type AskReply =
  | { status: 'answered'; answer: string; citations: AskCitation[] }
  | { status: 'nothing' }
  | { status: 'error'; code: string; message: string };

export async function askJournal(question: string): Promise<AskReply> {
  const reply: AskReply | undefined = await chrome.runtime.sendMessage({ type: ASK_MESSAGE, question });
  return reply ?? { status: 'error', code: 'internal', message: 'Trailmap could not answer that.' };
}
