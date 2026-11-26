import type { Expedition, ExpeditionKind } from '@trailmap/shared';

export type CardExpedition = Pick<Expedition, 'id' | 'startedAt' | 'endedAt' | 'kind' | 'threadId'>;
export type OrganisationAction =
  | { action: 'start' }
  | { action: 'merge' }
  | { action: 'add'; threadId: string }
  | { action: 'classify'; kind: ExpeditionKind };
export type OrganisationPlan =
  | { action: 'start'; expeditionIds: string[] }
  | { action: 'add'; expeditionIds: string[]; threadId: string }
  | { action: 'merge'; intoId: string; fromIds: string[] }
  | { action: 'classify'; expeditionIds: string[]; kind: ExpeditionKind };

/** Cards, drop targets, and inline actions use the same eligibility and merge ordering. */
export function planOrganisation(selection: readonly CardExpedition[], request: OrganisationAction): OrganisationPlan | null {
  const selected = [...new Map(selection.map((expedition) => [expedition.id, expedition])).values()]
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const expeditionIds = selected.map(({ id }) => id);
  if (!selected.length) return null;
  switch (request.action) {
    case 'start': case 'add':
      if (selected.some((e) => e.threadId || e.kind !== 'learning' || e.endedAt === null)) return null;
      if (request.action === 'start') return selected.length >= 2 ? { action: 'start', expeditionIds } : null;
      return { ...request, expeditionIds };
    case 'merge':
      return selected.length >= 2 && selected.every(({ endedAt }) => endedAt !== null)
        ? { action: 'merge', intoId: expeditionIds[0]!, fromIds: expeditionIds.slice(1) } : null;
    case 'classify': {
      const changed = selected.filter(({ kind }) => kind !== request.kind).map(({ id }) => id);
      return changed.length ? { ...request, expeditionIds: changed } : null;
    }
  }
}
