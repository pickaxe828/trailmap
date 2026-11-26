import { expect, test } from 'bun:test';
import { resolveChatGptDefault } from './chatgpt-default';

const catalog = (...slugs: string[]) => slugs.map((slug) => ({ slug, displayName: slug }));

test('chooses the newest version within each preferred ChatGPT tier regardless of catalog order', () => {
  const models = catalog('gpt-8-sol', 'gpt-7.9-luna', 'gpt-7-terra', 'gpt-7.2-terra', 'gpt-7.10-luna', 'gpt-7.1-terra');
  expect(resolveChatGptDefault(models, 'extraction')?.slug).toBe('gpt-7.10-luna');
  expect(resolveChatGptDefault(models, 'notes')?.slug).toBe('gpt-7.2-terra');
});

test('moves up to the next available ChatGPT tier before using the first catalog entry', () => {
  const models = catalog('other-model', 'gpt-9-sol', 'gpt-8-astra', 'gpt-7-terra');
  expect(resolveChatGptDefault(models, 'extraction')?.slug).toBe('gpt-7-terra');
  for (const group of ['extraction', 'notes'] as const) {
    expect(resolveChatGptDefault(models.slice(0, 3), group)?.slug).toBe('gpt-8-astra');
    expect(resolveChatGptDefault(models.slice(0, 2), group)?.slug).toBe('gpt-9-sol');
    expect(resolveChatGptDefault(models.slice(0, 1), group)?.slug).toBe('other-model');
    expect(resolveChatGptDefault([], group)).toBeUndefined();
  }
});

test('notes do not fall back down to Luna unless it happens to be the first catalog entry', () => {
  const models = catalog('gpt-8-superterra', 'gpt-8-luna');
  expect(resolveChatGptDefault(models, 'notes')?.slug).toBe('gpt-8-superterra');
  expect(resolveChatGptDefault(models, 'extraction')?.slug).toBe('gpt-8-luna');
});
