# Google Search capture fixtures

- `ai-mode-saved.html` is reduced from a signed-in conversation saved on 2026-11-28. It keeps the initial and same-document reply envelopes, the suggestion control, and the citation/source boundaries. Answers are shortened and links replaced with `.test` URLs. It contains no account data, tracking IDs, scripts or images.
- `ai-mode.html` uses the same reply envelopes with synthetic answers and a local driver for streaming, repeated questions and unknown layouts. `ai-mode-landing.html` is a synthetic composer/form that covers the first navigation; it is not from the saved page.
- `ai-overview.html` is a synthetic ordinary Search result: Overview text is never captured. The AI Mode tab uses the saved page’s link classes and the `mstk` URL shape reported in the live session.

Extractor tests parse the HTML without scripts. Chromium tests fulfill Google routes from these files and replay the saved conversation one submission at a time; no requests go to Google.
