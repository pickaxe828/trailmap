import type { ReactNode } from 'react';
import { defineTheme, Theme } from '@astryxdesign/core/theme';
import { BODY_FONT_STACK, HEADING_FONT_STACK } from './fonts';
import { defaultThemeSlug, themes } from '../astryx-themes';

const trailmapTheme = defineTheme({
  name: 'trailmap',
  extends: themes[defaultThemeSlug],
  // Neutral's dark card token matches the body. Use the same raised surface for cards and panels.
  tokens: {
    '--color-background-card': 'var(--color-background-surface)',
    // System fonts only; the stack ends with fonts that cover IPA and rare scripts (see fonts.ts).
    '--font-family-body': BODY_FONT_STACK,
    '--font-family-heading': HEADING_FONT_STACK,
  },
});

/** Wraps every extension page in the Astryx theme. Dark mode follows the OS (`mode="system"`). */
export function Root({ children }: { children: ReactNode }) {
  return <Theme theme={trailmapTheme}>{children}</Theme>;
}
