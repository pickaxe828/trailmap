# Trailmap

An MV3 extension for Chromium, Firefox and Zen that turns learning-oriented browsing into **trails**, **field notes** and a **concept graph**, without you taking notes. A small local **companion** program uses Native Messaging for sign-in and model calls and keeps credentials out of extension storage.

- Spec: [docs/PLAN.md](docs/PLAN.md)
- Conventions for contributors and agents: [AGENTS.md](AGENTS.md)
- Work is tracked as epics and sub-issues in this repo's Issues.

Status: under construction.

## Install a release

Every merge to `main` that passes CI is published on the [Releases](../../releases) page:
- the Chromium build (`trailmap-<version>-chrome.zip`);
- the Firefox and Zen build (`trailmap-<version>-firefox.zip`), plus a signed `.xpi` when AMO keys are configured;
- the companion for macOS (Apple silicon and Intel) and Linux (x64 and arm64);
- `SHA256SUMS`.

Each release's notes give the install steps.

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

Register the companion with `packages/companion/dist/trailmap-companion install`. It finds Chrome (stable, Beta, Canary), Chromium, Brave, Edge, Arc, Vivaldi, Helium and Firefox-family browsers on macOS and Linux. For a custom Chromium profile, use `install --browser chromium --user-data-dir <dir>`.

To try it by hand, open `chrome://extensions`, enable Developer mode, choose **Load unpacked** and pick `packages/extension/.output/chrome-mv3`. The Chromium extension ID is always `boahmdajmiicaicaopfgkcdaahidmalm`.

## Firefox and Zen

Requires Firefox 153+ or Zen based on Gecko 153+. Trailmap uses the same sidebar app and companion, with add-on ID `trailmap@pickaxe828`.

1. Build with `bun run build:firefox && bun run lint:firefox`. The unpacked build is `packages/extension/.output/firefox-mv3`.
2. Install the companion for Firefox and Zen in one line: `bun run build:companion && packages/companion/dist/trailmap-companion install --browser firefox`.
3. For a temporary install, go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select the Firefox build's `manifest.json`. Click Trailmap in the browser toolbar to open its sidebar. Temporary add-ons are removed on restart.
4. In Trailmap **Settings → Companion**, look for **Companion connected**. In **Model providers**, sign in with ChatGPT if you want Page notes. Firefox and Zen do not have Chrome's built-in model; local MiniLM embeddings are separate. If MiniLM can't run, **Settings → Diagnostics** reports it; capture and keyword search still work.

Native Messaging manifests go in `~/Library/Application Support/Mozilla/NativeMessagingHosts/` on macOS (verified in Zen 1.24.3b; it did **not** use `~/Library/Application Support/zen/NativeMessagingHosts/`) and `~/.mozilla/native-messaging-hosts/` on Linux. LibreWolf also gets a manifest in its own directory. `--mozilla-dir <dir>` overrides the parent directory (the installer appends `NativeMessagingHosts` or `native-messaging-hosts`). `uninstall` accepts the same flags; `--browser all` is the default for both commands.

### Install permanently with an unlisted signature

Build first, then set `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` in your shell environment from [your AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/). Do not put them in the repo or in command-line arguments. Run:

```sh
bun run build:firefox
bun run sign:firefox
```

`sign:firefox` uses `web-ext sign --channel unlisted` and writes the signed `.xpi` under `packages/extension/.output/firefox-signed`. Open `about:addons` and choose **Install Add-on From File…** in the gear menu. Increase the extension version in `packages/extension/package.json` for a new AMO submission of the same ID. If AMO requires the pre-build source archive, pass `--upload-source-code /path/to/source.zip` to `bun run sign:firefox`.

Zen 1.24.3b on macOS honored `xpinstall.signatures.required=false` in a throwaway profile: it accepted a permanent unsigned test XPI with the pref off and rejected it with the pref on. Use a signed XPI for everyday use; do not turn off signature checks in your normal profile.

### Smoke test

With GeckoDriver 0.36+ and `zip` on `PATH`, run `bunx playwright install firefox` and `bun run e2e:firefox` after building the Firefox extension and companion. Set `FIREFOX_BINARY` to test a specific Firefox or Zen executable instead. The test uses a throwaway home and profile, visits two local fixture pages, and checks Visit lineage, the sidebar app, Page extraction and the companion handshake. By default it blocks the model download to verify the diagnostics notice. Set `TRAILMAP_REAL_MINILM=1` to opt into downloading MiniLM data and checking actual local embeddings.
