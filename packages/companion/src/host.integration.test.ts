/** Spawns the real companion process (host mode) and talks to it over stdio, as the browser does. */
import { afterEach, expect, test } from 'bun:test';
import { EXTENSION_ID } from '../../extension/extension-key';
import { FrameDecoder, encodeFrame } from './framing';

const MAIN = new URL('./main.ts', import.meta.url).pathname;
const ORIGIN = `chrome-extension://${EXTENSION_ID}/`;

let child: ReturnType<typeof Bun.spawn> | undefined;
afterEach(() => child?.kill());

function startHost(args: string[] = [ORIGIN], env: Record<string, string> = {}) {
  const proc = Bun.spawn(['bun', MAIN, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    env: { ...process.env, ...env },
  });
  child = proc;
  const decoder = new FrameDecoder();
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  void (async () => {
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      for (const json of decoder.push(chunk)) queue.push(JSON.parse(json));
      wake?.();
    }
    wake?.();
  })();
  return {
    proc,
    write: (bytes: Uint8Array) => {
      (proc.stdin as { write(b: Uint8Array): number; flush(): void }).write(bytes);
      (proc.stdin as { flush(): void }).flush();
    },
    async next(): Promise<unknown> {
      const deadline = Date.now() + 5000;
      while (queue.length === 0) {
        if (Date.now() > deadline) throw new Error('timed out waiting for a frame');
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 50);
        });
      }
      return queue.shift();
    },
  };
}

const textFrame = (text: string) => {
  const body = new TextEncoder().encode(text);
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, true);
  frame.set(body, 4);
  return frame;
};

test('the host announces itself, then answers hello even when the request arrives in pieces', async () => {
  const host = startHost();
  expect(await host.next()).toMatchObject({ type: 'event', name: 'companion.ready' });

  const frame = encodeFrame({ type: 'companion.hello', id: 'h1' });
  host.write(frame.subarray(0, 2));
  await Bun.sleep(30);
  host.write(frame.subarray(2, 9));
  await Bun.sleep(30);
  host.write(frame.subarray(9));
  expect(await host.next()).toMatchObject({ type: 'companion.hello', id: 'h1', version: expect.any(String) });
});

test('invalid messages get typed errors and the host keeps serving', async () => {
  const host = startHost();
  await host.next(); // ready

  host.write(textFrame('{nope'));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'invalid_json', id: null });

  host.write(encodeFrame({ type: 'fetch.url', id: 'x', url: 'https://example.com' }));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'unknown_message', id: 'x' });

  host.write(encodeFrame({ type: 'companion.hello', id: 99 }));
  expect(await host.next()).toMatchObject({ type: 'error', code: 'invalid_message' });

  host.write(encodeFrame({ type: 'companion.hello', id: 'still-alive' }));
  expect(await host.next()).toMatchObject({ type: 'companion.hello', id: 'still-alive' });
});

test('the host exits cleanly when the browser closes its stdin', async () => {
  const host = startHost();
  await host.next();
  (host.proc.stdin as { end(): void }).end();
  expect(await host.proc.exited).toBe(0);
});

test('a host started for a different origin refuses to serve', async () => {
  const host = startHost(['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']);
  expect(await host.proc.exited).not.toBe(0);
});
