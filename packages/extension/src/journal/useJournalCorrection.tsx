import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { useRef, useState } from 'react';
import { correctJournal, type JournalAction } from './messages';

export function useJournalCorrection() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const undoId = history.at(-1);
  const [undone, setUndone] = useState(false);

  async function run(action: JournalAction) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(false);
    setUndone(false);
    const id = await correctJournal(action);
    if (id) {
      setHistory((current) => action.action === 'undo' ? current.filter((entry) => entry !== action.correctionId) : [...current, id]);
      setUndone(action.action === 'undo');
    } else setError(true);
    pending.current = false;
    setBusy(false);
    return !!id;
  }

  const feedback = (
    <HStack gap={2} align="center" wrap="wrap">
      {error && <Text role="alert">Could not apply this change. The expedition or thread may have changed.</Text>}
      <Text role="status" type="supporting">{undone ? 'Change undone.' : undoId && 'Change saved.'}</Text>
      {undoId && <Button label="Undo" size="sm" isDisabled={busy} onClick={() => void run({ action: 'undo', correctionId: undoId })} />}
    </HStack>
  );
  return { run, busy, feedback };
}
