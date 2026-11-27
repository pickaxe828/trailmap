# YouTube fixtures

Reconstructions of a watch page, served by the E2E tests through `context.route` on `www.youtube.com`
(the capture rules key on the real host). Nothing leaves the machine.

**Not verified against the live site.** The shapes follow what is publicly known: an inline
`ytInitialPlayerResponse` with `videoDetails` and
`captions.playerCaptionsTracklistRenderer.captionTracks[]` (`baseUrl`, `languageCode`, `kind: "asr"` for
automatic captions), and `json3` caption data (`events[].segs[].utf8`). All selectors live in
`packages/extension/src/capture/youtube.ts`; update that module and these files together.

- `watch.html`: video `aaaaaaaaaaa`, English manual, English automatic and German tracks.
- `watch-no-captions.html`: video `bbbbbbbbbbb`, no `captions` at all.
- `timedtext-*.json`: the caption data each track's `baseUrl` returns.
- `player.js`: a canvas-stream `<video>` with `fixturePlay()` / `fixturePause()`.
