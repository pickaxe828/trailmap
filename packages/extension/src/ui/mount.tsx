import './globals.css'; // first: declares the cascade-layer order (see globals.css)
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';

/** Mounts an extension page's React tree into `#root` inside the Astryx theme. */
export function mount(page: ReactNode) {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');
  createRoot(container).render(<Root>{page}</Root>);
}
