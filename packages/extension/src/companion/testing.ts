/** Fakes for driving CompanionClient without a browser or a companion. */
import type { NativeConnection, NativeTransport, Scheduler } from './client';

export class FakeConnection implements NativeConnection {
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  private messageListener: (m: unknown) => void = () => {};
  private disconnectListener: (e: string | undefined) => void = () => {};

  send(message: unknown) {
    this.sent.push(message as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
  onMessage(cb: (m: unknown) => void) {
    this.messageListener = cb;
  }
  onDisconnect(cb: (e: string | undefined) => void) {
    this.disconnectListener = cb;
  }

  /** Test helper: the companion sends a message. */
  receive(message: unknown) {
    this.messageListener(message);
  }
  /** Test helper: the browser reports the port closed (host missing, crashed, exited...). */
  disconnect(error?: string) {
    this.disconnectListener(error);
  }
  /** The id of the most recent request the client sent. */
  get lastId(): string {
    return this.sent.at(-1)!.id as string;
  }
}

export class FakeTransport implements NativeTransport {
  readonly connections: FakeConnection[] = [];
  connect() {
    const connection = new FakeConnection();
    this.connections.push(connection);
    return connection;
  }
  get latest(): FakeConnection {
    return this.connections.at(-1)!;
  }
}

/** A manual clock: nothing fires until `advance`. */
export class FakeScheduler implements Scheduler {
  private now = 0;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number) {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.now + ms, fn });
    return handle;
  }
  clearTimeout(handle: unknown) {
    this.timers.delete(handle as number);
  }
  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = target;
  }
}
