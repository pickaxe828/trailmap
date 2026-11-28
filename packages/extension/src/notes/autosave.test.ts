import { expect, test } from 'bun:test';
import { createNoteAutosave, NOTE_AUTOSAVE_MS } from './autosave';

test('leaving a Visit flushes its pending draft before the next Visit gets an editor', async () => {
  let now = 0;
  const timers = new Map<() => void, number>();
  function advance(ms: number) {
    now += ms;
    for (const [run, due] of timers) {
      if (due > now) continue;
      timers.delete(run);
      run();
    }
  }
  const saved = new Map<string, { text: string; sessionId: string }>();
  let id = 0;
  const editor = (visitId: string) => createNoteAutosave({
    save: async (text, sessionId) => { saved.set(visitId, { text, sessionId }); return true; },
    schedule: (run, delay) => { timers.set(run, now + delay); return () => { timers.delete(run); }; },
    newId: () => String(++id),
  });

  const first = editor('first');
  first.change('One paragraph');
  advance(NOTE_AUTOSAVE_MS);
  expect(saved.get('first')).toEqual({ text: 'One paragraph', sessionId: '1' });
  first.change('One paragraph\n\nA second thought');
  advance(NOTE_AUTOSAVE_MS - 1);
  expect(saved.get('first')?.text).toBe('One paragraph');
  first.finish(); // the current Visit changed before the timer could run
  const second = editor('second');
  second.change('A different page');
  expect([...saved]).toEqual([['first', { text: 'One paragraph\n\nA second thought', sessionId: '1' }]]);
  advance(NOTE_AUTOSAVE_MS);
  expect(saved.get('second')).toEqual({ text: 'A different page', sessionId: '2' });
  expect(saved.get('first')?.text).toBe('One paragraph\n\nA second thought');
});
