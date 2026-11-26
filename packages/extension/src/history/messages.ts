export const HISTORY_IMPORT_PORT = 'trailmap.historyImport';
export const HISTORY_RANGES = ['30', '60', '90'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export function isHistoryRange(value: unknown): value is HistoryRange {
  return HISTORY_RANGES.some((range) => range === value);
}

export type HistoryImportRequest = { type: 'start'; days: HistoryRange } | { type: 'cancel' };
export type HistoryImportStatus =
  | { state: 'idle' | 'reading' | 'cancelling' | 'paused' | 'failed' }
  | { state: 'writing'; processed: number; total: number }
  | { state: 'done' | 'cancelled'; added: number };

export function isImportRunning({ state }: HistoryImportStatus) {
  return state === 'reading' || state === 'writing' || state === 'cancelling';
}
