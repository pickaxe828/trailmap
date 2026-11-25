import { CORRECTION_MESSAGE, type CorrectionRequest } from './messages';

type Action = CorrectionRequest['action'];
type Body<A extends Action> = Omit<Extract<CorrectionRequest, { action: A }>, 'type' | 'action'>;

/** Sends a correction to the service worker. Resolves to its reply, or false if it failed. */
export async function correct<A extends Action>(action: A, body: Body<A>): Promise<boolean | string | null> {
  try {
    const reply: unknown = await chrome.runtime.sendMessage({ type: CORRECTION_MESSAGE, action, ...body });
    return typeof reply === 'string' || typeof reply === 'boolean' || reply === null ? reply : false;
  } catch {
    return false;
  }
}
