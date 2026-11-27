export const CORRECTION_MESSAGE = 'trailmap.correction';
export const MY_NOTES_LIMIT = 100_000;

export type CorrectionRequest = { type: typeof CORRECTION_MESSAGE } & (
  | { action: 'current-visit'; tabId: number }
  | { action: 'star'; visitId: string; starred: boolean }
  | { action: 'note'; nodeId: string; text: string }
  | { action: 'split'; visitId: string }
  | { action: 'ignore-site'; visitId: string }
  | { action: 'rename'; expeditionId: string; title: string }
  | { action: 'my-notes'; expeditionId: string; text: string }
  | { action: 'merge'; intoId: string; fromId: string }
  | { action: 'move'; visitId: string; toExpeditionId: string }
  | { action: 'forget-page'; canonicalUrl: string }
  | { action: 'forget-expedition'; expeditionId: string }
  | { action: 'forget-site'; host: string }
);

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function isCorrectionRequest(value: unknown): value is CorrectionRequest {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.type !== CORRECTION_MESSAGE) return false;
  switch (r.action) {
    case 'current-visit': return Number.isInteger(r.tabId);
    case 'star': return isString(r.visitId) && typeof r.starred === 'boolean';
    case 'note': return isString(r.nodeId) && typeof r.text === 'string' && r.text.length <= 20_000;
    case 'split': case 'ignore-site': return isString(r.visitId);
    case 'rename': return isString(r.expeditionId) && typeof r.title === 'string';
    case 'my-notes': return isString(r.expeditionId) && typeof r.text === 'string' && r.text.length <= MY_NOTES_LIMIT;
    case 'merge': return isString(r.intoId) && isString(r.fromId);
    case 'move': return isString(r.visitId) && isString(r.toExpeditionId);
    case 'forget-page': return isString(r.canonicalUrl);
    case 'forget-expedition': return isString(r.expeditionId);
    case 'forget-site': return isString(r.host);
    default: return false;
  }
}
