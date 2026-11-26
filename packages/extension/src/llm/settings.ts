import { LlmProviderId, type LlmTaskGroup } from '@trailmap/shared';
import { z } from 'zod';

const settingsKey = (group: LlmTaskGroup) => `trailmap.modelRoute.${group}`;
const ModelRoute = z.object({ provider: LlmProviderId, model: z.string().min(1).max(200).optional() });
export type ModelRoute = z.infer<typeof ModelRoute>;
export type ModelRoutes = Record<LlmTaskGroup, ModelRoute>;
const defaultRoute = { provider: 'chatgpt' } as const;

export async function readModelRoutes(): Promise<ModelRoutes> {
  const keys = [settingsKey('extraction'), settingsKey('notes')];
  const values = await chrome.storage.local.get(keys);
  return {
    extraction: ModelRoute.parse(values[settingsKey('extraction')] ?? defaultRoute),
    notes: ModelRoute.parse(values[settingsKey('notes')] ?? defaultRoute),
  };
}

export function saveModelRoute(group: LlmTaskGroup, route: ModelRoute) {
  const { provider, model } = ModelRoute.parse(route);
  return chrome.storage.local.set({ [settingsKey(group)]: model ? { provider, model } : { provider } });
}

export function onModelRoutesChanged(listener: () => void) {
  const onChanged: Parameters<typeof chrome.storage.local.onChanged.addListener>[0] = (changes) => {
    if (settingsKey('extraction') in changes || settingsKey('notes') in changes) listener();
  };
  chrome.storage.local.onChanged.addListener(onChanged);
  return () => chrome.storage.local.onChanged.removeListener(onChanged);
}
