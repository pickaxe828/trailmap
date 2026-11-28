# YouTube fixtures

These watch pages are reconstructions, not verified against live YouTube. E2E serves them at
`www.youtube.com` through `context.route` and records requests other than document navigation and
the fixture player script. Nothing leaves the machine.

- `watch.html`: captioned video `aaaaaaaaaaa`. Its inline `ytInitialPlayerResponse.videoDetails`
  supplies the title and description. Caption URLs are present to catch accidental requests.
- `watch-no-captions.html`: video `bbbbbbbbbbb`, without captions. Also serves as the one allowed
  watch HTML fetch after a same-document navigation leaves the original inline response stale.
- `player.js`: `fixturePlay()` starts a canvas-stream video without a media file.

`packages/extension/src/capture/youtube.ts` validates the response against the current video ID.
Transcripts are deferred: reliable access would need an official captions API or a specialised
extractor, and long transcripts would need chunking or summarisation to fit the model context.
