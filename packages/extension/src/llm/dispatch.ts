import type { Table } from 'dexie';
import type { LlmCompletion } from '@trailmap/shared';
import { getCompanionClient } from '../companion/background';
import type { TrailmapDb } from '../db/db';

/** Every Trailmap model call goes here. The companion waits for the durable log entry before sending text. */
export async function requestModel(
  db: TrailmapDb,
  payload: Omit<LlmCompletion, 'auditId'>,
  guard: { canonicalUrl?: string; canonicalUrls?: string[]; visitIds?: string[]; tables: Table[]; allow: () => Promise<boolean> },
) {
  const client = getCompanionClient();
  const auditId = crypto.randomUUID();
  let active = true;
  const unsubscribe = client.onEvent((event) => {
    if (event.name !== 'llm.dispatch' || event.auditId !== auditId) return;
    const { id: dispatchId, provider, model, instructions, input } = event;
    void (async () => {
      const allow = await db.transaction('rw', [db.sentToModel, ...guard.tables], async () => {
        if (!active || !await guard.allow() || !active) return false;
        await db.sentToModel.add({
          id: dispatchId, at: Date.now(), task: payload.task, canonicalUrl: guard.canonicalUrl,
          canonicalUrls: guard.canonicalUrls, visitIds: guard.visitIds, provider, model, instructions, input,
        });
        return true;
      }).catch(() => false); // No durable log, no outbound text.
      if (active) await client.request('llm.dispatchAck', { dispatchId, allow });
    })().catch(() => {}); // A lost port cannot authorize a send.
  });
  try {
    return await client.request('llm.complete', { ...payload, auditId });
  } finally {
    active = false;
    unsubscribe();
  }
}
