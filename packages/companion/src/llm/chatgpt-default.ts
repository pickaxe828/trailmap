import type { LlmModel, LlmTaskGroup } from '@trailmap/shared';

const TIERS = ['luna', 'terra', 'astra', 'sol'];
const SLUG = /^gpt-(\d+(?:\.\d+)*)-([a-z]+)$/;
const versionOrder = new Intl.Collator('en', { numeric: true });

/** Pick the lightest eligible tier, then its newest version. Keep catalog order for ties and unknown families. */
export function resolveChatGptDefault(models: readonly LlmModel[], group: LlmTaskGroup): LlmModel | undefined {
  const minimumTier = group === 'extraction' ? 0 : 1;
  let best: { model: LlmModel; tier: number; version: string } | undefined;
  for (const model of models) {
    const [, version, family] = SLUG.exec(model.slug) ?? [];
    if (!version || !family) continue;
    const tier = TIERS.indexOf(family);
    if (tier < minimumTier) continue;
    if (!best || tier < best.tier || (tier === best.tier && versionOrder.compare(version, best.version) > 0)) {
      best = { model, tier, version };
    }
  }
  return best?.model ?? models[0];
}
