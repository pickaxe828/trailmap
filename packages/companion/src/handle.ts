import { CompanionRequest, type CompanionResponse } from '@trailmap/shared';

export const COMPANION_VERSION = '0.0.0';

/** Validates one incoming message against the shared schema and answers it. */
export function handleMessage(raw: unknown): CompanionResponse {
  const parsed = CompanionRequest.safeParse(raw);
  if (!parsed.success) {
    const id =
      typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string' ? raw.id : null;
    return { type: 'error', id, message: 'Unknown or malformed message' };
  }
  return { type: 'companion.hello', id: parsed.data.id, version: COMPANION_VERSION };
}
