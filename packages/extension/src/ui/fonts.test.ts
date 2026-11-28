import { expect, test } from 'bun:test';
import { BODY_FONT_STACK, HEADING_FONT_STACK, IPA_COVERAGE_FONTS } from './fonts';

test('the font stack falls back to system fonts that cover IPA on macOS, Windows and Linux, before the generic family', () => {
  for (const stack of [BODY_FONT_STACK, HEADING_FONT_STACK]) {
    const names = stack.split(',').map((name) => name.trim().replace(/"/g, ''));
    expect(names.at(-1)).toBe('sans-serif');
    for (const font of ['Lucida Grande', 'Segoe UI', 'DejaVu Sans', 'Noto Sans']) expect(names).toContain(font);
    // Coverage fonts come after the UI fonts, so Latin text keeps its normal look.
    expect(names.indexOf('Noto Sans')).toBeGreaterThan(names.indexOf('Arial'));
    expect(names.indexOf('Noto Sans')).toBeLessThan(names.length - 1);
  }
  expect(IPA_COVERAGE_FONTS.length).toBeGreaterThan(5);
});

test('no stack entry is a remote font', () => {
  expect(BODY_FONT_STACK + HEADING_FONT_STACK).not.toMatch(/https?:|url\(/);
});
