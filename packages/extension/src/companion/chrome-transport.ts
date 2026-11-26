import { NATIVE_HOST_NAME } from '@trailmap/shared';
import type { NativeConnection, NativeTransport } from './client';
import { nativeDisconnectReason } from '../platform/browser';

/**
 * The real browser behind `NativeTransport`. `connectNative` never throws for a missing host: it returns a
 * port that disconnects at once with "Specified native messaging host not found.", which the client reads as
 * "not installed". An open native port also keeps the MV3 service worker alive.
 */
export const chromeTransport: NativeTransport = {
  connect(): NativeConnection {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    return {
      send: (message) => port.postMessage(message),
      close: () => port.disconnect(),
      onMessage: (cb) => port.onMessage.addListener(cb),
      onDisconnect: (cb) => port.onDisconnect.addListener(() => cb(nativeDisconnectReason(port))),
    };
  },
};
