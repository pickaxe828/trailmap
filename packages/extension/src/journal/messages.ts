import { ExpeditionKind, SuggestionTarget } from '@trailmap/shared';
import { z } from 'zod';
import type { OrganisationPlan } from './organise';

const id = z.string().min(1);
const ids = z.array(id).min(1);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), expeditionIds: ids }),
  z.object({ action: z.literal('add'), expeditionIds: ids, threadId: id }),
  z.object({ action: z.literal('merge'), intoId: id, fromIds: ids }),
  z.object({ action: z.literal('classify'), expeditionIds: ids, kind: ExpeditionKind }),
  z.object({ action: z.literal('accept'), expeditionId: id, target: SuggestionTarget }),
  z.object({ action: z.literal('dismiss'), expeditionId: id, target: SuggestionTarget }),
  z.object({ action: z.literal('undo'), correctionId: id }),
]);
export type JournalAction = z.infer<typeof actionSchema> | OrganisationPlan;
export const journalMessage = z.object({ type: z.literal('trailmap.journalCorrection'), input: actionSchema });

export async function correctJournal(input: JournalAction): Promise<string | null> {
  try {
    const result: unknown = await chrome.runtime.sendMessage({ type: 'trailmap.journalCorrection', input });
    return typeof result === 'string' ? result : null;
  } catch { return null; }
}
