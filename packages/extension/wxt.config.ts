import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { EXTENSION_PUBLIC_KEY } from './extension-key';

/**
 * The generated `src/astryx-themes.ts` imports the theme's fonts.css, which is a
 * Google Fonts @import. Trailmap is local-first and must not phone home from
 * its own pages, so that import resolves to an empty stylesheet and the theme's
 * system-font fallback applies. (Bundling the font files locally is a later option.)
 */
const noRemoteFonts = {
  name: 'trailmap:no-remote-fonts',
  enforce: 'pre' as const,
  resolveId: (id: string) => (/^@astryxdesign\/theme-[^/]+\/fonts\.css$/.test(id) ? '\0trailmap-no-fonts.css' : null),
  load: (id: string) => (id === '\0trailmap-no-fonts.css' ? '/* remote fonts disabled */' : null),
};

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [noRemoteFonts, tailwindcss()],
  }),
  manifest: {
    name: 'Trailmap',
    description: 'Turns learning-oriented browsing into trails, field notes and a concept graph.',
    key: EXTENSION_PUBLIC_KEY,
    // docs/PLAN.md §8
    permissions: [
      'webNavigation',
      'tabs',
      'history',
      'favicon',
      'idle',
      'storage',
      'unlimitedStorage',
      'sidePanel',
      'offscreen',
      'alarms',
      'nativeMessaging',
    ],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    action: { default_title: 'Open Trailmap' },
    options_ui: { page: 'settings.html', open_in_tab: true },
    commands: {
      'toggle-recording': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Pause or resume Trailmap recording',
      },
    },
  },
});
