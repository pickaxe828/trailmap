import type { ModelSources, Visit } from '@trailmap/shared';
import { eligibleMetadata, recordingState, type RecordingSettings } from './policy';

export function modelSources(visits: Visit[], ...dependencies: (ModelSources | undefined)[]): ModelSources {
  return {
    visitIds: [...new Set([...visits.map(({ id }) => id), ...dependencies.flatMap((value) => value?.visitIds ?? [])])].sort(),
    canonicalUrls: [...new Set([...visits.flatMap(({ url, canonicalUrl }) => [url, canonicalUrl]),
      ...dependencies.flatMap((value) => value?.canonicalUrls ?? [])])].sort(),
  };
}

export function allowsSources(source: ModelSources | undefined, visits: ReadonlyMap<string, Visit>, settings: RecordingSettings): boolean {
  return !source || (source.visitIds.every((id) => eligibleMetadata(visits.get(id), settings)) &&
    source.canonicalUrls.every((url) => recordingState(url, settings) === 'recording'));
}
