export const DIGEST_MESSAGE = 'trailmap.digest.generate';

export type DigestReply =
  /** A model job was queued; the digest appears in the Journal when it is written. */
  | { status: 'queued' }
  /** Nothing from the last 7 days may go to a model, so there was nothing to write and nothing was sent. */
  | { status: 'nothing' }
  | { status: 'paused' };

export async function generateDigest(): Promise<DigestReply> {
  const reply: DigestReply | undefined = await chrome.runtime.sendMessage({ type: DIGEST_MESSAGE });
  return reply ?? { status: 'nothing' };
}
