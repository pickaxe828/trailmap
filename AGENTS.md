# AGENTS

Guidance for AI coding agents working on **Trailmap**: a Chromium MV3 extension plus a local companion program.
The spec is [docs/PLAN.md](docs/PLAN.md). Read §3 (domain model) before writing code.

## Layout

| Path | What it is |
|---|---|
| `packages/extension` | WXT + React 19 extension. Pages live in `src/entrypoints/<name>/` (`index.html`, `main.tsx`, `App.tsx`). `src/db/` is the Dexie database. `src/ui/` holds shared UI plumbing (`globals.css`, `Root.tsx`, `mount.tsx`). `extension-key.ts` holds the public key and extension ID. |
| `packages/companion` | Bun program that talks to the extension over Native Messaging (`host.ts` loop, `handle.ts` router, `framing.ts`, `installer.ts`, `secrets.ts`). Compiled with `bun build --compile`. CLI: `install [--user-data-dir <dir>]`, `uninstall`. |
| `packages/shared` | Zod schemas and domain types (`domain.ts`), the Native Messaging message schemas (`messages.ts`) and 1 MB result paging (`chunking.ts`). Imported as `@trailmap/shared` by both of the above. |
| `e2e/` | Playwright end-to-end tests, the harness (`fixtures.ts`) and the fixture site (`site/`, `fixture-server.ts`). |

## Scripts (run from the repo root)

| Command | What it does |
|---|---|
| `bun install` | Install everything (one lockfile, Bun workspaces). |
| `bun run typecheck` | `tsc --noEmit` in every package and in `e2e/`. |
| `bun run test` | Runs `bun test` in every package (unit tests; `fake-indexeddb` for the database). |
| `bun run build` | Builds the unpacked extension to `packages/extension/.output/chrome-mv3`. |
| `bun run build:companion` | Compiles the companion to `packages/companion/dist/trailmap-companion`. |
| `bun run e2e` | Playwright E2E, headless. **Needs `bun run build` first**: it loads the built extension. |
| `bun run dev` | WXT dev server with hot reload (opens a browser; tests do not use it). |
| `bun run astryx <cmd>` | The Astryx CLI at the project's pinned version. Astryx is a dependency of `packages/extension`, so the CLI must run from there; this script does the `cd`. |

Before you finish a ticket run all of: `bun run typecheck && bun run test && bun run build && bun run build:companion && bun run e2e`.

## Conventions

- **Bun only.** `bun`, `bunx`, `bun test`. Never npm, pnpm or yarn. Pin dependency versions exactly (no `^` or `~`).
- **UI:** Astryx components first. Use Tailwind v4 utilities (mapped to Astryx tokens by `tailwind-theme.css`) for anything the components' props do not cover. **No hand-written CSS files, no inline `style`, no hard-coded colours or pixel values.** The one CSS file, `src/ui/globals.css`, only declares the layer order and imports; its `@layer` line must stay above the Tailwind imports. Start new pages with `bun run astryx build "<what the page is for>"`.
- **App shell:** Use `src/ui/TrailmapShell.tsx` on every full-tab page. Supply the page title, description and actions to the shell; it owns the top bar and page background. The side panel uses the compact `TrailmapNavigation` header.
- **Action affordances:** Use the `astryx` CLI to pick components. Use text-styled commands only in a visibly bounded toolbar or button group, or as labeled icon buttons; never set them inline beside prose or alone among plain items. Navigation uses visibly distinct Astryx links (accent colour and/or underline), never `ghost`. Links are for moving between places. The main call to action of a flow, form, dialog or banner (Finish setup, Continue, Save and go back, Fix connection) is a `primary` (or, for a banner's single action, `secondary`) `Button` even when it loads another page (`Button href` or `window.location.assign`); never a link. Commands use `secondary` (or `primary`) at size `sm`; destructive commands use `destructive` or a specific labeled icon button (e.g. `aria-label="Remove rawcdn.githack.com"`).
- **No remote requests from extension pages.** The theme's Google Fonts import is stubbed out in `wxt.config.ts`; do not add CDNs, remote fonts or analytics. **Exception (ticket 15):** the offscreen Embedder can fetch MiniLM model assets on a cold cache. Input text stays local. `TRAILMAP_REAL_MINILM=1 bun run e2e --grep MiniLM` opts into the real-model smoke test, which skips offline and is disabled in CI; the default E2E suite uses the fake Embedder.
- **Renderer exceptions:** React Flow needs its bundled base stylesheet and numeric SVG/ELK geometry; keep that geometry in named constants at the Trail renderer. Sigma needs its hidden DOM/canvas probe to convert Astryx theme colors to hex. Neither exception applies to ordinary UI.
- **Domain vocabulary** comes from PLAN.md §3: Visit, Page, Query, Expedition, Thread, Concept, Edge, Highlight, Note; plus field notes, loose ends, living note, Atlas, Journal, companion. Use these words in code, test names and UI copy.
- **Schemas live in `@trailmap/shared`.** Anything that crosses the extension/companion boundary is a Zod schema there, validated on receipt. The companion has a short fixed command set; never add "fetch a URL" or "read a file" messages.
- **Database:** `packages/extension/src/db/db.ts`. Never edit an existing `version(n)` block; add `version(n + 1)`. Unit tests get `fake-indexeddb` from the test preload in `packages/extension/bunfig.toml` and use a unique database name per test.
- **Tests:** build test-first (red, then green). Keep tests deterministic: fake the clock, the embedder and the LLM behind interfaces; point the companion at `Bun.serve` mocks; never call real OpenAI or Anthropic endpoints, or download anything, in tests.
- **Privacy is a feature.** Never log tokens, keys or page text. Never commit secrets, private keys or `.env` files.
- **Commits:** small Conventional Commits.

## Capture (navigation lineage)

`packages/extension/src/capture/` turns browser events into Visits (PLAN §4.1).

- `recorder.ts` (`VisitRecorder`) is the one place that decides parents, transitions and active time. It never touches `chrome.*`: it takes a `BrowserEventSource` (`events.ts`), a `RecorderStateStore` (`state-store.ts`), a clock and an id generator. `chrome-events.ts` is the only file with `chrome.*` calls; `testing.ts` has `FakeBrowser` and `FakeClock` for unit tests.
- Later tickets extend the recorder rather than adding their own navigation listeners: `recorder.subscribe(listener)` reports every Visit created or updated, `recorder.getCurrentVisit(tabId)` says what a tab is showing, and the `shouldRecord(url)` option is where privacy filters plug in.
- Anything that must survive a service-worker restart goes in `RecorderState` (saved after every event).

## Corrections and Forget

`packages/extension/src/corrections/` holds the side panel's one-click fixes (star, note, split, move, merge, rename, ignore site, forget).

- `createCorrections` (`corrections.ts`, `forget.ts`) works on Dexie only. Each correction is one transaction that also writes a `corrections` log row with before/after state. `service.ts` routes side panel messages in the service worker; ignore-site goes through the privacy controller's `setSiteSkipped`, and forgets go through `recorder.forgetVisits` so an open tab can't write the forgotten Visit back.
- **New derived data must join the Forget cascade** (`forgetCascade` in `forget.ts`) and carry `targetIds` in any correction-log entry that mentions it. The cascade test scans every table for the forgotten text, so a missed table fails there.

## Journal undo

`packages/extension/src/journal/recent.ts` reads Recent changes (latest 20 undoable `journal-*` corrections) and explains refused undos (`forgotten | undone | conflict`). Undo is the log row's `before` payload, so new derived data must keep joining the Forget cascade, which deletes the row. Details: `trailmap-notes/notes-33.md`.

## Wrap-up and field notes

`packages/extension/src/wrapup/`: closing an Expedition queues `expedition_wrap_up` (title, driving question, learning/errand, merge suggestions), which queues `field_notes` for learning Expeditions. Model inputs are built in `trail.ts` (no Page text, privacy filtered); handlers in `handlers.ts` take a `request` seam for tests. `fieldNotesWritten` (`hooks.ts`) is the "notes written" hook for later tickets. Details: `trailmap-notes/notes-13.md`.

## My notes

`Expedition.myNotes` is the user's own Markdown, kept beside the generated `fieldNotes` (which never carry user edits). `packages/extension/src/notes/` builds the `notes_enrichment` input (`input.ts`, user text only, setting-aware), debounces and queues it (`enqueue.ts`) and runs it (`handler.ts`). Its concepts are `ConceptEvidence` rows with role `learned` (`concepts/learned.ts`), anchored at the Expedition or at the stop a note is attached to. Anything that sends or ranks notes must honour `usesMyNotes(settings)`. Details: `trailmap-notes/notes-25.md`.

## Atlas: what I learned

`ConceptEvidence.salience` (from enrichment; `central` for notes) × the Visit's current engagement × highlights and stars give an evidence strength: `learned | studied | seen` (`concepts/strength.ts`, pure; `strength-read.ts` loads the context). `readAtlas` returns `concepts` (learned or studied), `seen` (shown only on the "Include concepts I only saw" switch) and `dismissed`; `readVisibleConcepts` (search, vault) follows the same rule. "I didn't learn this" is a `dismissedConcepts` row (`concepts/dismiss.ts`) keyed by `evidenceKey`; it joins the Forget cascade. A table read inside a `db.transaction` must be listed in it (`highlights` and `dismissedConcepts` now are, for every caller of `readVisibleConcepts`). Read thresholds are `READ_ACTIVE_MS` and `READ_SCROLL_DEPTH` in `capture/engagement.ts`. Details: `trailmap-notes/notes-46.md`.

## Thread matching

`packages/extension/src/threads/`: `description.ts` builds the text embedded for an Expedition (title, question, My notes, concepts, field-notes summary); `match.ts` holds `THREAD_BANDS`, `scoreMatch` and the `thread_match` handler, which waits for concept resolution and re-embeds a stored `threadSignature` whose `descriptionHash` changed; `runs.ts` is the diagnostics log (`threadMatchRuns`, ids and numbers only, part of the Forget cascade). Band thresholds are calibrated against recorded MiniLM vectors in `threads/fixtures/`: after changing `buildDescription` or the fixtures run `bun scripts/record-thread-fixtures.ts` (needs the network once) in `packages/extension`; `fixtures.test.ts` fails until you do. Details: `trailmap-notes/notes-28.md`.

## YouTube transcripts

`packages/extension/src/capture/youtube.ts` holds every YouTube selector, JSON path and URL rule (none verified against the live site; fixtures in `e2e/site/youtube/`). On a `youtube.com/watch` page the content script (after the recorder admitted the Visit) takes the Page text from the inline `ytInitialPlayerResponse` caption track, fetched once same-origin with no cookies, or the title and description without captions, or nothing when the shape is not exactly as expected; it never runs Readability on a watch page. After a single-page navigation the inline data is stale, so the watch URL's own HTML is fetched once instead. Engagement for a watch Visit is `Visit.watchMs` (video playing while the tab is visible, `watch-video.ts`) scored by `scoreVideoEngagement`, never scroll depth. Enrichment input carries `contentKind: 'video'`. Details: `trailmap-notes/notes-38.md`.

## Extension identity

The manifest `key` pins the extension ID, so it is the same on every machine and every build:

```
boahmdajmiicaicaopfgkcdaahidmalm
```

Only the **public** key is committed (`packages/extension/extension-key.ts`). The private key was generated once and kept **outside the repo** at `~/.trailmap/extension-key.pem` on the maintainer's machine. It is only needed to pack a `.crx`, never to load the extension unpacked. A unit test re-derives the ID from the public key. The companion's Native Messaging manifest will use `chrome-extension://boahmdajmiicaicaopfgkcdaahidmalm/` as its `allowed_origins`.

## E2E

`bun run e2e` runs Playwright (`e2e/*.e2e.ts`, config in `e2e/playwright.config.ts`).

- Import `test` and `expect` from `e2e/fixtures.ts`, not from `@playwright/test`. Its `context` fixture launches Playwright's Chromium (`channel: 'chromium'`, headless) in a **persistent context** with `packages/extension/.output/chrome-mv3` loaded.
- Fixtures: `extensionId` (read from the service worker URL), `openExtensionPage('sidepanel.html')` (opens `chrome-extension://<id>/<path>` in a tab) and `fixtureUrl('learn.test', '/article.html')`.
- **Fake hostnames.** Chromium runs with `--host-resolver-rules=MAP *.test 127.0.0.1`, and a Bun process (`e2e/fixture-server.ts`, started by Playwright's `webServer`) serves `e2e/site/` on port 4173. So fixture pages live at `http://learn.test:4173/...`, never on `localhost`, because the privacy deny-list will hide localhost. Add pages by dropping HTML into `e2e/site/`.
- **Companion in E2E.** `test.use({ companionInstalled: true })` installs the real compiled companion (`bun run build:companion` first) into the test's profile folder; `installCompanion()` does it mid-test; override the `companionEnv` fixture to point the companion at mock servers. Every test already gets its own profile (`userDataDir`) and companion data dir, and the real Keychain is never touched. See `e2e/companion.e2e.ts`.
- You cannot open the real side panel UI headless; test it by opening `sidepanel.html` as a normal tab.
- Playwright runs under Node (via `bunx playwright`); only the fixture server runs under Bun. Test files must not use Bun-only APIs.
- **Wait on state, not time.** Use readiness signals (`readCapture`, `aiModeScreened()`, `seedCapture` waits for stores); no sleeps, private short timeouts, or worker handles held across a restart. Details and how to hunt a flake: `trailmap-notes/notes-35.md`.

## Companion

- **Adding a verb:** add its request/response schemas to `messages.ts`, then add a handler to `defaultHandlers` in `packages/companion/src/handle.ts` (typecheck fails until you do). From the extension call `getCompanionClient().request('<verb>', payload)` (`src/companion/background.ts`, background only). Handlers get `ctx` (`env`, `secrets`, `log`); never log secrets or page text, and never return a secret in a message.
- stdout of the companion is **frames only**; diagnostics go through `ctx.log` (stderr plus `~/.trailmap/companion.log`).
- Environment knobs: `TRAILMAP_COMPANION_DATA_DIR` (default `~/.trailmap`), `TRAILMAP_SECRET_STORE=file|keychain` (default keychain on macOS). Later tickets read mock-server URLs from `TRAILMAP_*` variables via `ctx.env`.
- The status the side panel shows is mirrored by the background into `chrome.storage.session` (`src/companion/status.ts`).
- Details and gotchas: `trailmap-notes/notes-05.md`.

## CI

`.github/workflows/ci.yml` (ubuntu): install, typecheck, test, build, build:companion, then install Chromium and run E2E. It runs on pull requests to any branch and on pushes to `main` and `integration`.

## Astryx

The block below was written by `astryx init`, run from `packages/extension` (where Astryx is installed), and copied here. After an Astryx upgrade, run `bun run astryx init --agent codex`, copy the refreshed block from the `packages/extension/AGENTS.md` it writes into this file, and delete that file. Run its commands as `bun run astryx <cmd>` from the repo root.

<!-- ASTRYX:START -->
Astryx v0.7.7 · 90+ components
CLI: run every command as `bunx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-*|--spacing-*|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
