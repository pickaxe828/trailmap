import { expect, test } from 'bun:test';
import { vaultFilename } from './vault-path';

test('only accepts single relative Markdown filenames', () => {
  expect(vaultFilename('Research notes.md')).toBe('Research notes.md');
  for (const path of ['/note.md', 'C:\\note.md', 'C:note.md', '../note.md', 'a/../note.md', 'a/note.md', '..\\note.md', '.md', 'a\0.md', 'note.txt']) {
    expect(() => vaultFilename(path)).toThrow('relative Markdown filename');
  }
});
