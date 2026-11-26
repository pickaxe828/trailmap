import type { Expedition, SuggestionTarget } from '@trailmap/shared';

export function dismissed(source: Expedition, target: SuggestionTarget, other?: Expedition): boolean {
  return !!source.dismissedSuggestions?.some(({ kind, id }) => kind === target.kind && id === target.id) ||
    !!other?.dismissedSuggestions?.some(({ kind, id }) => kind === 'expedition' && id === source.id);
}

export function mergeSuggestionsByExpedition(expeditions: Expedition[]) {
  const byId = new Map(expeditions.map((expedition) => [expedition.id, expedition]));
  const pairs = new Map<string, Expedition[]>();
  function add(source: Expedition, target: Expedition) {
    const suggestions = pairs.get(source.id) ?? [];
    if (!suggestions.some(({ id }) => id === target.id)) pairs.set(source.id, [...suggestions, target]);
  }
  for (const source of expeditions) {
    if (source.endedAt === null) continue;
    for (const { expeditionId } of source.mergeSuggestions ?? []) {
      const target = byId.get(expeditionId);
      if (!target || target.id === source.id || target.endedAt === null ||
        dismissed(source, { kind: 'expedition', id: target.id }, target)) continue;
      add(source, target);
      add(target, source);
    }
  }
  return pairs;
}
