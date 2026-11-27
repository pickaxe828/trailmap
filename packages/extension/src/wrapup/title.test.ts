import { expect, test } from 'bun:test';
import { guardTitle, hasReadableWords } from './title';

test('a lone IPA modifier letter is not a readable title', () => {
  for (const title of ['ˤ', 'ʕ', 'ʔ', 'ˤ ʕ ʔ', '≣', ' ', '?!', '42', 'ʕʔ']) expect(hasReadableWords(title)).toBe(false);
});

test('a symbol with its name is a readable title', () => {
  for (const title of ['ˤ: the pharyngealization mark in IPA', 'How CRDTs delete', 'Ʒ', '日本語', 'Why is ʔ a glottal stop']) {
    expect(hasReadableWords(title)).toBe(title !== 'Ʒ');
  }
});

test('guardTitle keeps a worded title and appends the first usable fallback to a symbol-only one', () => {
  expect(guardTitle('How CRDTs delete', ['unused'])).toBe('How CRDTs delete');
  expect(guardTitle('ˤ', ['', 'What is ˤ in IPA?'])).toBe('ˤ: What is ˤ in IPA?');
  expect(guardTitle('ˤ', ['ʕ', 'pharyngealization'])).toBe('ˤ: pharyngealization');
  expect(guardTitle('ˤ', [])).toBe('ˤ: untitled research');
});
