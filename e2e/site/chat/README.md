# Chat assistant fixtures

Local reconstructions of the DOM shapes Trailmap's extractors look for on Gemini, ChatGPT and Claude. They are not copies of the live pages (those need an account and change without notice). The questions, replies and links are synthetic, and nothing loads a remote script, model or account.

`driver.js` renders the markup for each site (user message, assistant message, streaming and completion markers, and chrome that must stay out of a transcript), answers a few canned questions after a short delay, and exposes `window.fixtureChat`. The unit tests evaluate the same file in JSDOM, so the markup has one source. The page's earlier turn (`Earlier question about tides`) is shared or previously loaded history, which must never be captured.

The Chromium tests fulfil `https://chatgpt.com/**`, `https://claude.ai/**` and `https://gemini.google.com/**` from these files with `context.route`, because the capture rules key on the real host names; no request leaves the machine.

Shapes (all undocumented, so each extractor reads only a complete, unambiguous match and otherwise leaves the question alone):

| Site | User message | Assistant message | Complete when |
|---|---|---|---|
| ChatGPT | `[data-message-author-role="user"]` | `[data-message-author-role="assistant"]` | its turn has `button[data-testid="copy-turn-action-button"]` |
| Claude | `[data-testid="user-message"]` | `[data-is-streaming]` | `data-is-streaming="false"` |
| Gemini | `user-query .query-text` | `model-response message-content` | `aria-busy` is not `true` and the response has a Copy button |
