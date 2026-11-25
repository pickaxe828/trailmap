/**
 * Typed client for the companion (docs/PLAN.md §6.1). Lives in the background
 * service worker. It owns one Native Messaging connection, reconnects with
 * backoff, tracks connection status, and exposes `request(verb, payload)`.
 *
 * It has no `chrome.*` imports: the browser is behind `NativeTransport`, and
 * time behind `Scheduler`, so unit tests drive it with fakes (testing.ts).
 */
import {
  ChunkAssembler,
  ChunkFrame,
  CompanionEvent,
  CompanionResponse,
  ErrorDetails,
  LLM_REQUEST_TIMEOUT_MS,
  type CompanionRequest,
  type CompanionRequestType,
  type ErrorCode,
} from '@trailmap/shared';

export interface NativeConnection {
  send(message: unknown): void;
  close(): void;
  onMessage(cb: (message: unknown) => void): void;
  /** `error` is the browser's reason (chrome.runtime.lastError.message), if any. */
  onDisconnect(cb: (error: string | undefined) => void): void;
}
export interface NativeTransport {
  connect(): NativeConnection;
}
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type CompanionStatus =
  | { state: 'connecting' }
  | { state: 'connected'; version: string }
  /** The browser could not find (or is not allowed to use) the host manifest: `trailmap-companion install` was not run. */
  | { state: 'not-installed' }
  | { state: 'disconnected'; reason?: string };

export type RequestErrorCode = ErrorCode | 'not_connected' | 'timeout';

export class CompanionRequestError extends Error {
  constructor(readonly code: RequestErrorCode, message: string, readonly details: ErrorDetails = {}) {
    super(message);
    this.name = 'CompanionRequestError';
  }
}

export type RequestPayload<T extends CompanionRequestType> = Omit<Extract<CompanionRequest, { type: T }>, 'type' | 'id'>;
export type ResponseFor<T extends CompanionRequestType> = Extract<CompanionResponse, { type: T }>;

export const HELLO_TIMEOUT_MS = 5_000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

const HOST_MISSING = [/not found/i, /forbidden/i];

const defaultScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Settle = (result: CompanionResponse | CompanionRequestError) => void;

interface Pending {
  settle: Settle;
  timer: unknown;
}

export interface CompanionClientOptions {
  transport: NativeTransport;
  scheduler?: Scheduler;
  newId?: () => string;
}

export class CompanionClient {
  private readonly transport: NativeTransport;
  private readonly scheduler: Scheduler;
  private readonly newId: () => string;

  private _status: CompanionStatus = { state: 'disconnected' };
  private modelAudit = false;
  private readonly statusListeners = new Set<(status: CompanionStatus) => void>();
  private readonly eventListeners = new Set<(event: CompanionEvent) => void>();

  private connection: NativeConnection | null = null;
  private assembler = new ChunkAssembler();
  private readonly pending = new Map<string, Pending>();
  private readyWaiters: Array<{ resolve: () => void; reject: (e: CompanionRequestError) => void }> = [];
  private retryTimer: unknown = null;
  private failures = 0;
  private stopped = true;

  constructor({ transport, scheduler = defaultScheduler, newId = () => crypto.randomUUID() }: CompanionClientOptions) {
    this.transport = transport;
    this.scheduler = scheduler;
    this.newId = newId;
  }

  get status(): CompanionStatus {
    return this._status;
  }

  get supportsModelAudit(): boolean {
    return this._status.state === 'connected' && this.modelAudit;
  }

  /** Calls `fn` on every status change (not with the current status). Returns an unsubscribe function. */
  subscribe(fn: (status: CompanionStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Calls `fn` for every event the companion pushes. Returns an unsubscribe function. */
  onEvent(fn: (event: CompanionEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** Connects (and keeps reconnecting) until `stop()`. */
  start(): void {
    this.stopped = false;
    if (this.connection === null) this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.dropConnection();
    this.failAll('not_connected', 'Companion client stopped');
    this.setStatus({ state: 'disconnected' });
  }

  /** Retry now instead of waiting out the backoff (e.g. the side panel opened). Does nothing while connected or connecting. */
  reconnectNow(): void {
    if (this.stopped || this.connection !== null) return;
    this.clearRetry();
    this.failures = 0;
    this.connect();
  }

  /**
   * Sends one request and resolves with its response. Rejects with `CompanionRequestError`:
   * `not_connected`, `timeout`, or the companion's own error code.
   */
  async request<T extends CompanionRequestType>(type: T, payload: RequestPayload<T>): Promise<ResponseFor<T>> {
    if (this._status.state === 'connecting') await this.whenReady();
    if (this._status.state !== 'connected') throw new CompanionRequestError('not_connected', 'The companion is not connected');
    if (type === 'llm.complete' && 'auditId' in payload && !this.supportsModelAudit) {
      throw new CompanionRequestError('not_connected', 'Update the companion before requesting AI notes.');
    }
    const response = await this.send({ type, ...payload } as Omit<CompanionRequest, 'id'>);
    return response as ResponseFor<T>;
  }

  // --- internals ---

  private whenReady(): Promise<void> {
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  private setStatus(status: CompanionStatus) {
    this._status = status;
    for (const fn of this.statusListeners) fn(status);
  }

  private clearRetry() {
    if (this.retryTimer !== null) this.scheduler.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private connect() {
    this.setStatus({ state: 'connecting' });
    const connection = this.transport.connect();
    this.connection = connection;
    this.assembler = new ChunkAssembler();
    // Callbacks from a connection we've since dropped must not touch the current one.
    const current = () => this.connection === connection;
    connection.onMessage((message) => current() && this.onFrame(message));
    connection.onDisconnect((error) => current() && this.onDisconnected(error));

    // Handled with plain callbacks, not promises, so the status flips in the same tick the answer arrives.
    this.sendWith({ type: 'companion.hello' }, HELLO_TIMEOUT_MS, (result) => {
      if (!current()) return;
      if (result instanceof CompanionRequestError || result.type !== 'companion.hello') {
        // Connected but never (correctly) answered: not a companion we can use. Drop it and retry.
        const reason = result instanceof CompanionRequestError ? result.message : 'Unexpected answer to hello';
        this.dropConnection();
        this.afterFailure({ state: 'disconnected', reason });
        return;
      }
      this.failures = 0;
      this.modelAudit = result.modelAudit === true;
      this.setStatus({ state: 'connected', version: result.version });
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      for (const w of waiters) w.resolve();
    });
  }

  private dropConnection() {
    const connection = this.connection;
    this.connection = null;
    connection?.close();
  }

  private onDisconnected(error: string | undefined) {
    this.connection = null;
    this.failAll('not_connected', 'The companion disconnected');
    const missing = error !== undefined && HOST_MISSING.some((re) => re.test(error));
    this.afterFailure(missing ? { state: 'not-installed' } : { state: 'disconnected', reason: error });
  }

  private afterFailure(status: CompanionStatus) {
    this.failAll('not_connected', 'The companion disconnected');
    this.setStatus(status);
    if (this.stopped) return;
    const delay = Math.min(BACKOFF_START_MS * 2 ** this.failures, BACKOFF_MAX_MS);
    this.failures += 1;
    this.clearRetry();
    this.retryTimer = this.scheduler.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private failAll(code: RequestErrorCode, message: string) {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      this.scheduler.clearTimeout(p.timer);
      p.settle(new CompanionRequestError(code, message));
    }
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.reject(new CompanionRequestError(code, message));
  }

  private send(request: Omit<CompanionRequest, 'id'>): Promise<CompanionResponse> {
    const timeout = request.type === 'llm.complete' || request.type === 'llm.models'
      ? LLM_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) =>
      this.sendWith(request, timeout, (result) =>
        result instanceof CompanionRequestError ? reject(result) : resolve(result),
      ),
    );
  }

  private sendWith(request: Omit<CompanionRequest, 'id'>, timeoutMs: number, settle: Settle) {
    const connection = this.connection;
    if (connection === null) return settle(new CompanionRequestError('not_connected', 'The companion is not connected'));
    const id = this.newId();
    const timer = this.scheduler.setTimeout(() => {
      this.pending.delete(id);
      settle(new CompanionRequestError('timeout', `The companion did not answer ${request.type}`));
    }, timeoutMs);
    this.pending.set(id, { settle, timer });
    connection.send({ ...request, id });
  }

  private onFrame(raw: unknown) {
    const chunk = ChunkFrame.safeParse(raw);
    if (chunk.success) {
      const whole = this.assembler.add(chunk.data);
      if (whole !== null) this.onFrame(whole);
      return;
    }
    const event = CompanionEvent.safeParse(raw);
    if (event.success) {
      for (const fn of this.eventListeners) fn(event.data);
      return;
    }
    const response = CompanionResponse.safeParse(raw);
    if (!response.success) return; // not ours to understand; never crash on it
    const id = response.data.id;
    const pending = id === null ? undefined : this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id!);
    this.scheduler.clearTimeout(pending.timer);
    if (response.data.type === 'error') {
      pending.settle(new CompanionRequestError(response.data.code, response.data.message, ErrorDetails.parse(response.data)));
    } else {
      pending.settle(response.data);
    }
  }
}
