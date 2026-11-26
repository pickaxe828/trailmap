import { Expedition } from '@trailmap/shared';
import { z } from 'zod';

const id = z.string().min(1);
export const ThreadAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('attach'), expeditionId: id, target: Expedition.shape.threadSuggestion.unwrap(), suggested: z.boolean().optional() }),
  z.object({ action: z.literal('detach'), threadId: id, expeditionId: id }),
  z.object({ action: z.literal('merge'), threadId: id, sourceId: id }),
  z.object({ action: z.literal('split'), threadId: id, expeditionIds: z.array(id).min(2) }),
  z.object({ action: z.literal('rename'), threadId: id, title: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal('done'), threadId: id }),
]);
export type ThreadAction = z.infer<typeof ThreadAction>;
export type ThreadActionResult = { threadId: string | null } | null;
export const THREAD_CORRECTION = 'trailmap.threadCorrection';

export async function correctThread(action: ThreadAction): Promise<ThreadActionResult> {
  return chrome.runtime.sendMessage({ type: THREAD_CORRECTION, ...action }).catch(() => null);
}
