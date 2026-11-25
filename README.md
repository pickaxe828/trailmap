# Trailmap

A Chromium MV3 extension that turns learning-oriented browsing into **trails**, **field notes** and a **concept graph**, without you taking notes. A small local **companion** program (Chrome Native Messaging) handles sign-in and model calls, so credentials never enter the browser.

- Spec: [docs/PLAN.md](docs/PLAN.md)
- Conventions for contributors and agents: [AGENTS.md](AGENTS.md)
- Work is tracked as epics and sub-issues in this repo's Issues.

Status: under construction.

## Quick start

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun run typecheck
bun run test
bun run build        # unpacked extension in packages/extension/.output/chrome-mv3
bun run e2e          # headless Playwright against the built extension (first run: bunx playwright install chromium)
bun run build:companion
```

To try it by hand, open `chrome://extensions`, enable Developer mode, choose **Load unpacked** and pick `packages/extension/.output/chrome-mv3`. The extension ID is always `boahmdajmiicaicaopfgkcdaahidmalm`.
