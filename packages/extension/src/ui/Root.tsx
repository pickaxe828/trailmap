import type { ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { defaultThemeSlug, themes } from '../astryx-themes';

/** Wraps every extension page in the Astryx theme. Dark mode follows the OS (`mode="system"`). */
export function Root({ children }: { children: ReactNode }) {
  return <Theme theme={themes[defaultThemeSlug]}>{children}</Theme>;
}
