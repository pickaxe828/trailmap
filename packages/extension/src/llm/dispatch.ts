import type { Table } from 'dexie';
import { LLM_PROVIDER_NAMES, llmTaskGroup, type LlmCompletion } from '@trailmap/shared';
import { getCompanionClient } from '../companion/background';
import type { TrailmapDb } from '../db/db';
import { readModelRoutes, type ModelRoute } from './settings';

/** Every Trailmap model call goes here. The companion waits for the durable log entry before sending text. */
export async function requestModel(
  db: TrailmapDb,
  payload: Omit<LlmCompletion, 'auditId' | 'provider' | 'model'>,
  guard: { canonicalUrl?: string; expeditionId?: string; canonicalUrls?: string[]; visitIds?: string[]; tables: Table[]; allow: () => Promise<boolean> },
  selectedRoute?: ModelRoute,
) {
  const group = llmTaskGroup(payload.task);
  const route = selectedRoute ?? (await readModelRoutes())[group];
  const client = getCompanionClient();
  const auditId = crypto.randomUUID();
  let active = true;
  const unsubscribe = client.onEvent((event) => {
    if (event.name !== 'llm.dispatch' || event.auditId !== auditId) return;
    const { id: dispatchId, provider, model, instructions, input } = event;
    void (async () => {
      const current = await readModelRoutes().then((routes) => routes[group]).catch(() => undefined);
      const matches = current?.provider === route.provider && current?.model === route.model &&
        provider === LLM_PROVIDER_NAMES[route.provider] && (!route.model || model === route.model);
      const allow = matches && await db.transaction('rw', [db.sentToModel, ...guard.tables], async () => {
        if (!active || !await guard.allow() || !active) return false;
        await db.sentToModel.add({
          id: dispatchId, at: Date.now(), task: payload.task, canonicalUrl: guard.canonicalUrl,
          expeditionId: guard.expeditionId, canonicalUrls: guard.canonicalUrls, visitIds: guard.visitIds,
          provider, model, instructions, input,
        });
        return true;
      }).catch(() => false); // No durable log, no outbound text.
      if (active) await client.request('llm.dispatchAck', { dispatchId, allow });
    })().catch(() => {}); // A lost port cannot authorize a send.
  });
  try {
    return await client.request('llm.complete', { ...payload, ...route, auditId });
  } finally {
    active = false;
    unsubscribe();
  }
}
