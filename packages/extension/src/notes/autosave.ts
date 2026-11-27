export const NOTE_AUTOSAVE_MS = 600;
export type SaveStatus = 'saving' | 'saved' | 'failed';

type Options = {
  /** Bound to the original Visit or Expedition for the editor's whole lifetime. */
  save: (text: string, sessionId: string) => Promise<boolean>;
  report?: (status: SaveStatus) => void;
  schedule?: (run: () => void, delay: number) => () => void;
  newId?: () => string;
};

const scheduleTimer: NonNullable<Options['schedule']> = (run, delay) => {
  const timer = setTimeout(run, delay);
  return () => clearTimeout(timer);
};

export function createNoteAutosave({ save, report, schedule = scheduleTimer, newId = () => crypto.randomUUID() }: Options) {
  let sessionId: string | undefined;
  let pending: string | undefined;
  let cancel: (() => void) | undefined;
  let revision = 0;

  function flush() {
    cancel?.();
    cancel = undefined;
    if (pending === undefined || !sessionId) return;
    const text = pending;
    pending = undefined;
    const saving = revision;
    void save(text, sessionId).then((ok) => {
      if (saving === revision) report?.(ok ? 'saved' : 'failed');
    }, () => {
      if (saving === revision) report?.('failed');
    });
  }

  return {
    change(text: string) {
      sessionId ??= newId();
      pending = text;
      revision++;
      report?.('saving');
      cancel?.();
      cancel = schedule(flush, NOTE_AUTOSAVE_MS);
    },
    // Blur and unmount close the edit, but neither re-targets nor drops its final draft.
    finish() {
      flush();
      sessionId = undefined;
    },
  };
}
