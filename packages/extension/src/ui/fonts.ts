/**
 * System fonts that cover IPA Extensions (U+0250–U+02AF) and Spacing Modifier Letters (U+02B0–U+02FF),
 * so symbols such as ˤ, ʕ and ʔ never fall through to a last-resort box. Nothing here is downloaded.
 * macOS: Lucida Grande, Arial Unicode MS. Windows: Segoe UI, Cambria, Times New Roman. Linux: DejaVu Sans, Noto Sans, FreeSans.
 */
export const IPA_COVERAGE_FONTS = [
  'Lucida Grande', 'Arial Unicode MS', 'Segoe UI Symbol', 'Cambria', 'Times New Roman', 'DejaVu Sans', 'Noto Sans', 'FreeSans',
] as const;

const UI_FONTS = ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial'];
const quoted = (font: string) => (font.includes(' ') ? `"${font}"` : font);

/** The Astryx neutral system stack plus the IPA coverage fonts, ahead of the generic family. */
export const BODY_FONT_STACK = [...UI_FONTS, ...IPA_COVERAGE_FONTS.map(quoted), 'sans-serif'].join(', ');
export const HEADING_FONT_STACK = BODY_FONT_STACK;
