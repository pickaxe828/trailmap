/**
 * Host mode: the loop the browser's Native Messaging launch drives.
 * stdout carries only frames (anything else would corrupt the stream), so all
 * diagnostics go through `ctx.log`, never `console.log`.
 */
import { chunkMessage, type CompanionEvent, type CompanionResponse } from '@trailmap/shared';
import { disposeChatGptAuth } from './auth/auth';
import { FrameDecoder, FrameTooLargeError, encodeFrame } from './framing';
import { COMPANION_VERSION, handleFrame, type CompanionContext } from './handle';

/** Reads frames from `input` until it ends (the browser closed the port). Resolves true on a clean end, false after a fatal error. */
export async function runHost(
  input: AsyncIterable<Uint8Array>,
  write: (frame: Uint8Array) => void,
  ctx: CompanionContext,
): Promise<boolean> {
  // One synchronous write per frame, so concurrent handlers never interleave bytes.
  const send = (message: CompanionResponse | CompanionEvent) => {
    for (const frame of chunkMessage(message)) write(encodeFrame(frame));
  };

  const dispatches = new Map<string, (allow: boolean) => void>();
  const context: CompanionContext = {
    ...ctx,
    async authorizeDispatch(auditId, dispatch) {
      const dispatchId = crypto.randomUUID();
      const { promise, resolve } = Promise.withResolvers<boolean>();
      dispatches.set(dispatchId, resolve);
      const timeout = setTimeout(() => resolve(false), 5_000);
      try {
        send({ type: 'event', name: 'llm.dispatch', auditId, id: dispatchId, ...dispatch });
        return await promise;
      } finally {
        clearTimeout(timeout);
        dispatches.delete(dispatchId);
      }
    },
    acknowledgeDispatch(dispatchId, allow) {
      dispatches.get(dispatchId)?.(allow);
    },
    emit(event) {
      try {
        send(event);
      } catch {
        ctx.log('failed to send an event');
      }
    },
  };
  send({ type: 'event', name: 'companion.ready', version: COMPANION_VERSION });

  const decoder = new FrameDecoder();
  try {
    for await (const chunk of input) {
      for (const json of decoder.push(chunk)) {
        // Requests run concurrently; responses carry the request id.
        void handleFrame(json, context).then(send).catch(() => ctx.log('failed to send a response'));
      }
    }
    return true;
  } catch (error) {
    // The stream cannot be resynchronised after a bad length prefix.
    const message = error instanceof FrameTooLargeError ? 'Incoming message too large' : 'Could not read from the browser';
    ctx.log(message);
    try {
      send({ type: 'event', name: 'companion.fatal', message });
    } catch {
      // Port already gone.
    }
    return false;
  } finally {
    for (const resolve of dispatches.values()) resolve(false);
    disposeChatGptAuth(context);
  }
}
