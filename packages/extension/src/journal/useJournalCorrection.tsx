import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { useRef, useState } from 'react';
import { openTrailmapDb } from '../db/db';
import { correctJournal, type JournalAction } from './messages';
import { REFUSAL_MESSAGE, undoRefusal } from './recent';

const FAILED = 'Could not apply this change. The expedition or thread may have changed.';
const TOAST_MS = 10_000;

async function refusalFor(correctionId: string) {
  const db = openTrailmapDb();
  try { return REFUSAL_MESSAGE[await undoRefusal(db, correctionId)]; } catch { return FAILED; } finally { db.close(); }
}

/** Runs Journal organise actions. Undo comes from the durable corrections log, via the toast or Recent changes. */
export function useJournalCorrection() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const show = useToast();

  async function run(action: JournalAction): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const id = await correctJournal(action);
    if (!id) setError(action.action === 'undo' ? await refusalFor(action.correctionId) : FAILED);
    else if (action.action === 'undo') show({ body: 'Change undone.', uniqueID: 'journal-change', autoHideDuration: TOAST_MS });
    else show({ body: 'Change saved.', uniqueID: 'journal-change', autoHideDuration: TOAST_MS, endContent:
      <Button label="Undo" size="sm" onClick={() => void run({ action: 'undo', correctionId: id })} /> });
    pending.current = false;
    setBusy(false);
    return !!id;
  }

  const feedback = error ? <Text role="alert">{error}</Text> : null;
  return { run, busy, feedback };
}
