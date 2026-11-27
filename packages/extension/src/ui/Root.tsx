import type { ReactNode } from 'react';
import { defineTheme, Theme } from '@astryxdesign/core/theme';
import { defaultThemeSlug, themes } from '../astryx-themes';

const trailmapTheme = defineTheme({
  name: 'trailmap',
  extends: themes[defaultThemeSlug],
  // Neutral's dark card token matches the body. Use the same raised surface for cards and panels.
  tokens: { '--color-background-card': 'var(--color-background-surface)' },
});

/** Wraps every extension page in the Astryx theme. Dark mode follows the OS (`mode="system"`). */
export function Root({ children }: { children: ReactNode }) {
  return <Theme theme={trailmapTheme}>{children}</Theme>;
}
