import type { Table } from 'dexie';
import { LLM_PROVIDER_NAMES, llmTaskGroup, type LlmCompletion } from '@trailmap/shared';
import { getCompanionClient } from '../companion/background';
import { CompanionRequestError } from '../companion/client';
import type { SentToModel, TrailmapDb } from '../db/db';
import { readModelRoutes, type ModelRoute } from './settings';

const recoveries = new WeakMap<TrailmapDb, Promise<unknown>>();

/** A new worker cannot receive the outcomes for its predecessor's native port. */
export function recoverModelAttempts(db: TrailmapDb) {
  let recovery = recoveries.get(db);
  if (!recovery) {
    recovery = db.sentToModel.where('outcome').equals('pending').modify({ outcome: 'cancelled', finishedAt: Date.now() })
      .catch((error) => { recoveries.delete(db); throw error; });
    recoveries.set(db, recovery);
  }
  return recovery;
}

type Completion = Pick<SentToModel, 'outcome' | 'output' | 'errorCode'>;
function finishAttempt(db: TrailmapDb, id: string, result: Completion, finishedAt: number) {
  // Never insert here: Forget may have removed the row while the model was running.
  return db.sentToModel.where('id').equals(id).and((row) => row.outcome === 'pending').modify({ ...result, finishedAt });
}

/** Every Trailmap model call goes here. The companion waits for the durable log entry before sending text. */
export async function requestModel(
  db: TrailmapDb,
  payload: Omit<LlmCompletion, 'auditId' | 'provider' | 'model'>,
  guard: { canonicalUrl?: string; expeditionId?: string; canonicalUrls?: string[]; visitIds?: string[]; jobId?: string; tables: Table[]; allow: () => Promise<boolean> },
  selectedRoute?: ModelRoute,
) {
  await recoverModelAttempts(db);
  const group = llmTaskGroup(payload.task);
  const route = selectedRoute ?? (await readModelRoutes())[group];
  const client = getCompanionClient();
  const auditId = crypto.randomUUID();
  let active = true;
  const writes = new Map<string, Promise<boolean>>();
  const outcomes: Promise<unknown>[] = [];
  const unsubscribe = client.onEvent((event) => {
    if (event.name === 'llm.dispatchFinished' && event.auditId === auditId) {
      const finishedAt = Date.now();
      const write = writes.get(event.id);
      if (write) outcomes.push(write.then((allowed) => allowed ? finishAttempt(db, event.id, event.result, finishedAt) : undefined).catch(() => {}));
      return;
    }
    if (event.name !== 'llm.dispatch' || event.auditId !== auditId) return;
    const { id: dispatchId, provider, model, instructions, input } = event;
    const write = (async () => {
      const current = await readModelRoutes().then((routes) => routes[group]).catch(() => undefined);
      const matches = current?.provider === route.provider && current?.model === route.model &&
        provider === LLM_PROVIDER_NAMES[route.provider] && (!route.model || model === route.model);
      return matches && await db.transaction('rw', [db.sentToModel, ...guard.tables], async () => {
        if (!active || !await guard.allow() || !active) return false;
        await db.sentToModel.add({
          id: dispatchId, at: Date.now(), task: payload.task, canonicalUrl: guard.canonicalUrl,
          expeditionId: guard.expeditionId, canonicalUrls: guard.canonicalUrls, visitIds: guard.visitIds,
          provider, model, instructions, input, jobId: guard.jobId, outcome: 'pending',
        });
        return true;
      });
    })().catch(() => false); // No durable log, no outbound text.
    writes.set(dispatchId, write);
    void write.then(async (allow) => {
      if (active) await client.request('llm.dispatchAck', { dispatchId, allow });
    }).catch(() => {}); // A lost port cannot authorize a send.
  });
  let terminal: Completion = { outcome: 'cancelled' };
  try {
    const reply = await client.request('llm.complete', { ...payload, ...route, auditId });
    terminal = { outcome: 'succeeded', output: reply.output };
    return reply;
  } catch (error) {
    const errorCode = error instanceof CompanionRequestError ? error.code : 'internal';
    terminal = { outcome: errorCode === 'dispatch_cancelled' || errorCode === 'not_connected' ? 'cancelled' : 'failed', errorCode };
    throw error;
  } finally {
    active = false;
    unsubscribe();
    await Promise.all(outcomes);
    const allowed = (await Promise.all([...writes].map(async ([id, write]) => await write ? id : undefined)))
      .filter((id) => id !== undefined);
    const finishedAt = Date.now();
    // Older companions only return the last result. Never infer a fallback's outcome from the final reply.
    const last = allowed.pop();
    await Promise.all([
      ...(last ? [finishAttempt(db, last, terminal, finishedAt)] : []),
      ...allowed.map((id) => finishAttempt(db, id, outcomes.length ? { outcome: 'cancelled' } : { outcome: undefined }, finishedAt)),
    ]).catch(() => {});
  }
}
