export const WRAP_UP_MESSAGE = 'trailmap.wrapUp';

/** Sent by the side panel's Wrap up button. */
export type WrapUpRequest = { type: typeof WRAP_UP_MESSAGE; expeditionId: string };

export function isWrapUpRequest(value: unknown): value is WrapUpRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return request.type === WRAP_UP_MESSAGE && typeof request.expeditionId === 'string' && request.expeditionId.length > 0;
}
