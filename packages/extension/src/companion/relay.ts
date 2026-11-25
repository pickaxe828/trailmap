import { z } from 'zod';
import { CompanionEvent, CompanionResponse, ErrorCode, ErrorDetails, type CompanionRequestType } from '@trailmap/shared';
import { CompanionRequestError, type RequestPayload, type ResponseFor } from './client';

export const COMPANION_RELAY = 'trailmap.companion.request';
export const COMPANION_EVENT = 'trailmap.companion.event';

export const RelayReply = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), response: CompanionResponse }),
  z.object({
    ok: z.literal(false),
    code: ErrorCode.or(z.enum(['not_connected', 'timeout'])),
    message: z.string(),
    details: ErrorDetails.optional(),
  }),
]);

const RelayedEvent = z.object({ type: z.literal(COMPANION_EVENT), event: CompanionEvent });

/** Extension pages use the service worker's Native Messaging connection. */
export async function requestCompanion<T extends CompanionRequestType>(
  type: T, payload: RequestPayload<T>,
): Promise<ResponseFor<T>> {
  const raw: unknown = await chrome.runtime.sendMessage({ type: COMPANION_RELAY, request: { ...payload, type } });
  const reply = RelayReply.safeParse(raw);
  if (!reply.success) throw new CompanionRequestError('internal', 'The companion returned an invalid response.');
  if (!reply.data.ok) throw new CompanionRequestError(reply.data.code, reply.data.message, reply.data.details);
  if (reply.data.response.type !== type) throw new CompanionRequestError('internal', 'The companion returned an unexpected response.');
  return reply.data.response as ResponseFor<T>;
}

export function onCompanionEvent(listener: (event: CompanionEvent) => void): () => void {
  const receive = (raw: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('/background.js')) return;
    const message = RelayedEvent.safeParse(raw);
    if (message.success) listener(message.data.event);
  };
  chrome.runtime.onMessage.addListener(receive);
  return () => chrome.runtime.onMessage.removeListener(receive);
}
