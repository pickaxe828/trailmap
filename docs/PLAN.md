# Trailmap: plan for a browser extension that maps your learning trips

*Working name. Draft, 2026-11-25.*

## 1. The idea

You browse to learn. You follow a link, start a search, open five tabs and read two of them. Trailmap watches quietly and does three things:

1. **Groups your browsing into *expeditions*.** An expedition is a run of browsing driven by one question, like "how do CRDTs handle deletes?"
2. **Draws each expedition as a trail.** The trail shows where you started, which search or link led where, what you read closely, and which branches you never opened.
3. **Builds an *Atlas* of concepts across all expeditions.** It also writes **field notes** for each expedition, so you don't have to.

You never have to take notes. The extension writes the notes, and you only correct them when you want to.

### 1.1 Features at a glance

**MVP (M0–M2): you browse and get trails and notes without doing anything.**

| Feature | What you get | Milestone |
|---|---|---|
| Quiet capture | Records how you move between pages, how long you actually read, what you searched for and what you highlighted. Skips private sites by default. | M0 |
| Companion + sign-in | Continue with ChatGPT, an Anthropic key, or Ollama. Credentials stay in the Keychain. | M0.5 |
| Expeditions | Browsing grouped automatically into trips around one question, each titled like "How do CRDTs handle deletes?". Errands are kept out of the way. | M1 |
| Live trail (side panel) | The current expedition growing as a small tree, with one-click star, note, split and ignore-site. | M1 |
| Corrections | Rename, merge, split, move a page, forget a page. | M1 |
| Page summaries | Each page you read gets a one-line summary, key takeaways and the concepts it covers. | M2 |
| Field notes | Written automatically when an expedition ends: the question, what you found, key ideas with sources, how the trail went, and loose ends. You can edit them. | M2 |
| Expedition page | The trail graph and the field notes side by side | M2 |
| Journal | All your expeditions, newest first | M2 |
| Obsidian sync | Each expedition becomes a note in your vault | M2 |
| Privacy controls | Pause, per-site toggle, forget, a "sent to model" log, handling of the weekly limit | M1–M2 |

**Later (M3–M4)**

| Feature | What you get | Milestone |
|---|---|---|
| Threads | Research you come back to over days or weeks is gathered into one thread. You get every session on a timeline, a living note that grows with each session, and a "picking up where you left off" card when you return (§4.7). | M3 |
| Atlas | A concept map across all expeditions. Concept cards answer "where did I learn this?". Includes a time-lapse of the map growing. | M3 |
| Search | Across pages, concepts and notes. Also from the address bar: type `tm` and a space. | M3 |
| History import | Rough trails built from the last 30–90 days of browsing history | M4 |
| Extras | Weekly digest, Ask (answers from your own pages), extractors for YouTube, PDFs and forums, Firefox, concept review | M4 |

### 1.2 User flow

The rule: **nothing requires your action.** Every button is a correction or an extra, never a chore.

**1. Setup (once, about 3 minutes)**
1. Install the extension. An onboarding tab opens.
2. **Privacy screen.** It shows what gets recorded and the default skip list, and you can add sites to skip. Recording starts straight away. Trails and expeditions work without any AI.
3. **Turn on AI notes (optional).** Install the companion with one command, `trailmap-companion install`. The onboarding tab detects it.
4. **Pick a model provider.** Click **Continue with ChatGPT**:
   1. A tab opens on OpenAI.
   2. You approve and set a weekly limit.
   3. The tab says "Signed in. You can close this tab."
   4. Onboarding shows "Signed in as you@…, plan usage on".

   Or paste an Anthropic key, or pick Ollama.
5. **Optional:** choose your Obsidian folder, and import recent history.

**2. Every day: just browse**
- The toolbar icon shows whether recording is on. Click it to open the side panel.
- In the side panel you can, if you want, ⭐ a key page, add a note, split off a new expedition, or ignore a site.
- Text you select or copy is saved as a highlight automatically.
- **Coming back to a topic days later (M3):** the side panel shows "Picking up: *CRDTs* (last session 4 days ago)", with what you found last time and your loose ends. Pages you've already read are marked, so you don't reread them by accident.

**3. When an expedition ends (automatic)**
- The expedition closes after 30 minutes idle, or when you click **Wrap up**.
- Field notes are written in the background and appear in the Journal and in Obsidian.
- The toolbar icon shows a small count of new notes. There are no pop-ups.

**4. Reviewing (whenever you want)**
- Open the Journal from the side panel. A one-off sitting shows as an expedition card. Research you've returned to over several days shows as one thread card.
- A thread page lays out every session on a timeline, next to a living note of everything you've learned on the topic so far.
- The expedition page shows the trail on the left and the field notes on the right. Click a node to see its summary or reopen the page.
- If the grouping is wrong, fix it there: rename, merge, or drag a page out. Edit the notes if you like.

**5. Finding things again (M3)**
- Type `tm crdt` in the address bar, or use search in the Journal. Results cover pages, concepts and notes.
- In the Atlas, click a concept to see the pages that taught it and the expeditions it came up in.

**6. When something needs attention**
- **ChatGPT weekly limit reached:** a banner says "AI notes paused until your limit resets. Browsing is still recorded." Notes catch up afterwards.
- **Companion missing:** trails keep working. AI features say "Companion not connected" and offer a button to fix it.
- **Privacy:** a pause hotkey for sensitive browsing, and "Forget" on any page, expedition or site.

## 2. Prior art and the gap

| Product | What it does | How Trailmap differs |
|---|---|---|
| **Anamnesis** (Phi Browser; Chrome extension) | Watches DOM events and screenshots. LLMs pull out *facts about you* and arrange them around a central "Self" node (Self → Learns → Python). Shown as a starfield ("Nebula"). Stored locally; you bring your own API key. | It is centred on **you** and built to give an AI assistant memory. It has no navigation trail and writes no notes about the subject itself. |
| **Graphora**, **Semantic Memory**, **Capsule**, **Recap** | Cluster your history by topic and add semantic search. Some run locally, some in the cloud. | Topic clusters only. They don't show "how I got here" and don't write synthesized notes. |

**The gap Trailmap fills:** keep the **trail** (the order you went in, branches, dead ends) and turn it into **knowledge about the subject**: concepts, how they relate, and notes with citations. Anamnesis answers "who is this person?" Trailmap answers "what did I learn, and how did I find it?"

> Cheap first step: use Anamnesis and Graphora for a week before writing code. Write down what annoys you. That list is your real spec.

### Non-goals (to keep the scope from creeping)
- **Memory for AI agents.** Feeding what you've investigated into ChatGPT, Claude or coding agents is a separate product, and mem0's **OpenMemory** already covers it. The OpenMemory *MCP server* is still available. Mem0 archived the OpenMemory *Chrome extension* in March 2026.
  - Trailmap's only concession is that its Markdown/Obsidian export is plain files, so any agent that can read a folder can use it.
  - No MCP server, no memory API, and nothing injected into chat sites.
- **Accounts, cloud sync or a hosted backend.** Sign in with ChatGPT (§7.1) only lets model calls run on your ChatGPT plan; it is not a Trailmap account. The only backend is the companion program on your own computer (§6.1).
- **Sharing, collaboration or mobile.**

## 3. Core model: two linked graphs

```
 EPISODIC (what you did)                    SEMANTIC (what you learned)
 ─────────────────────────                  ───────────────────────────
 Expedition "How do CRDTs handle deletes?"
   ├─ 🔍 "crdt delete tombstone"
   │    ├─ Wikipedia: CRDT ───── teaches ──▶  (CRDT) ──alternative_to──▶ (Operational Transform)
   │    │    └─ Shapiro et al. paper ─ teaches ▶  (Tombstone) ──part_of──▶ (CRDT)
   │    └─ blog post (bounced, 6s)
   └─ HN thread ─────────────── mentions ──▶  (Automerge) ──uses──▶ (CRDT)
         └─ ┄┄ unread tab: "Yjs internals"  ← loose end
```

**Entities** (all in IndexedDB):

| Entity | Key fields |
|---|---|
| `Visit` | url, canonicalUrl, title, tabId, parentVisitId, transition (link / typed / search / new-tab / back), startedAt, activeMs, scrollDepth, engagement (`bounced` / `skimmed` / `read`), expeditionId |
| `Page` | canonicalUrl, extracted text (capped), textHash, summary, takeaways[], embedding, pageKind, enrichedAt |
| `Query` | engine, q, at, expeditionId (search queries become *question* nodes) |
| `Expedition` | title, drivingQuestion, kind (`learning` / `errand`), startedAt, endedAt, fieldNotes (Markdown), userEdited, threadId |
| `Thread` | title, question, status (`active` / `dormant` / `done`), lastActiveAt, livingNote (Markdown), centroid embedding, conceptIds |
| `Concept` | name, aliases[], kind (concept / person / tool / work / event / place), gloss, embedding, exposure score, firstSeen |
| `Edge` | from, to, type, weight, evidence: visitIds[] |
| `Highlight` / `Note` | text the user selected or copied, plus optional manual notes on any node |

**Edge types, kept to a small fixed set:**
- *Trail edges:* `navigated_from`, `searched`, `opened_in_new_tab`.
- *Bridge edges:* `teaches`, `mentions`.
- *Concept edges:* `is_a`, `part_of`, `uses`, `alternative_to`, `contrasts_with`, `prerequisite_of`, `related_to`.

## 4. Pipeline

```
capture ──▶ filter ──▶ segment ──▶ enrich (LLM) ──▶ resolve concepts ──▶ synthesize notes ──▶ link to thread
 (live)      (live)    (live +      (queued,          (queued,             (when an              (after notes;
                        on close)    batched)          batched)             expedition closes)    updates living note)
```

### 4.1 Capture
- **Navigation lineage** comes from the background service worker:
  - `webNavigation.onCommitted` provides `transitionType` and qualifiers, which tell typed, link, form, back/forward and reload apart.
  - `webNavigation.onCreatedNavigationTarget` provides `sourceTabId`, so a link opened in a new tab becomes a branch.
  - `webNavigation.onHistoryStateUpdated` catches navigation inside single-page apps.
- **Active time** comes from `tabs.onActivated`, `windows.onFocusChanged`, `idle.onStateChanged` and `visibilitychange` in the page.
- **Page content** comes from a content script running `@mozilla/readability` about 2 s after load. It also records scroll depth, selections and copies. A selection or copy is the strongest sign that something mattered.
- **Search queries** are parsed from the URLs of known engines (Google, Bing, DDG, Kagi, YouTube, Wikipedia search). Each becomes a `Query` node.
- **Backfill on day one:** `chrome.history.search` plus `getVisits` returns `transition` and `referringVisitId`, which is often filled in. That is enough to rebuild rough trails from past history, using URLs and titles only. Page text can be enriched later if you want it.

### 4.2 Filter (keeping the mess out)
- **Engagement levels:** `bounced` is under 10 s active and no scroll. `skimmed` is 10–60 s. `read` is more than 60 s active, or more than 50% scrolled, or any selection or copy. Bounced visits stay as faint nodes in the trail and are never sent to the LLM.
- **Default deny-list:** mail, banking, calendars, chat, social feeds, checkout pages, localhost and intranet hosts, and any page with a password field.
- **Per-site toggle** in the side panel, plus a global pause hotkey. Skipping a site purges its Trailmap records and blocks future capture; pausing does not erase previous history.
- **URL canonicalization:** use `rel=canonical`, drop `utm_*` parameters and session tokens.

### 4.3 Segment into expeditions (the make-or-break step)
Rules, in order:
1. **Lineage wins.** A visit reached by link, or opened from another tab, joins its parent's expedition.
2. **New roots** are typed URLs, new searches and bookmarks. Embed the root's title or query and compare it with the centroids of expeditions open in the last 2 h. Join the best match if cosine is above about 0.6; otherwise start a new expedition. Several expeditions can run in parallel tabs at once.
3. **30 min idle** closes every open expedition.
4. **On close,** one LLM pass gives the expedition a title, states its driving question, classifies it as `learning` or `errand`, and suggests merges with same-day expeditions on the same topic.
5. **Manual fixes** are first-class: merge, split here, or drag a page to another expedition. Log every correction so the thresholds can be tuned later.

Errand expeditions (shopping, admin) collapse into the Journal and stay out of the Atlas.

### 4.4 Enrich each page (one LLM call per read or skimmed page, structured JSON output)
Input: title, URL, Readability text capped at about 3k tokens, any highlights (marked as important), the expedition's driving question, and the parent page's title. The last two tell the model *why* you came to this page.

```json
{
  "summary": "one sentence",
  "takeaways": ["2–5 concrete claims, not vibes"],
  "answers_question": "the question this page answers",
  "page_kind": "article|docs|paper|video|forum|reference|tool|other",
  "concepts": [{ "name": "Tombstone", "kind": "concept", "gloss": "≤20 words", "role": "explains|mentions|uses" }],
  "relations": [{ "from": "Tombstone", "to": "CRDT", "type": "part_of" }]
}
```

### 4.5 Resolve concepts (avoiding "concept soup")
- Embed `name + gloss` locally.
- An exact name or alias match merges. Cosine above 0.9 auto-merges. Between 0.8 and 0.9, queue the pair for a batched LLM verdict: `same` / `broader` / `narrower` / `related` / `different`. Below 0.8, create a new concept.
- **Under-extract, the same lesson Anamnesis learned.** A concept becomes visible only when it has at least 2 evidence pages, or one `read` page where it was the thing being `explained`. Keep a stoplist of over-general concepts ("Computer science", "Software").
- Every concept edge carries evidence visit IDs, so you can always click through to "where did I learn this?"

### 4.6 Synthesize field notes (when an expedition closes, or on demand)
Input: the expedition's page summaries, takeaways and highlights, in trail order. Output is Markdown:
- **Question:** what you set out to learn.
- **What you found:** a short answer.
- **Key ideas:** each one cites the page it came from.
- **How the trail went:** 2–3 sentences, e.g. "Started at Wikipedia, the Shapiro paper was the turning point…"
- **Loose ends:** tabs you opened but never read, and questions the pages raised.

### 4.7 Link expeditions into threads (research spread over days or weeks)

An expedition is one sitting. When you come back to a topic days later, that sitting is a new expedition, but it belongs to the same **thread**: the longer-running investigation.

- **Matching, when an expedition closes.** Compare it with threads active in the last 60 days. Use an embedding of its title, question and top concepts, plus how many concepts it shares with each thread.
  - **Strong match:** attach it automatically.
  - **Possible match:** show a one-tap "Part of *CRDTs*?" suggestion on the expedition's Journal card. Not a pop-up.
  - **No match:** the expedition stays on its own. It becomes a thread only when a second session joins, so one-off lookups don't clutter the Journal.
- **Picking up where you left off.** When a new search or page matches a dormant thread, the side panel shows:
  - "Picking up: *CRDTs* (last session 4 days ago)";
  - last time's summary and loose ends;
  - for pages you already read in that thread, a "read on Nov 21" badge and their old summary.
- **Living note.** Each thread has one note that grows with every session. It covers what you know so far, how your understanding changed, and which questions are still open.
  - It is updated incrementally: the current note plus the new session's field notes. It is never rebuilt from every page, which keeps it cheap.
  - It syncs to Obsidian as the thread's main note and links to each session's note.
- **On the graph:**
  - The **thread page** lays its sessions out on a timeline, each with its own trail. Lines connect sessions where you revisited a page or a concept came up again.
  - In the **Atlas**, each concept is already a single node that gathers evidence from every session, whenever it happened. Filtering by thread highlights that thread's part of the map.
- **Corrections:** attach or detach an expedition, merge or split threads, rename a thread, or mark it done. Errand expeditions never join threads.

## 5. Views

1. **Side panel, "Live trail"** (`chrome.sidePanel`): the current expedition grows as a small tree with a "you are here" marker. One-click actions: ⭐ key page, ✏️ note, ✂️ split here, 🚫 ignore site.
2. **Expedition page** (full tab):
   - The trail is drawn as a left-to-right layered graph.
   - Each node is a card with favicon, title and a one-line summary. Opacity shows engagement.
   - Search queries appear as question nodes.
   - Bounced pages collapse into "+4 skipped". Unread branches are dashed.
   - The field notes sit in a pane on the right and can be edited.
3. **Atlas** (full tab): the concept graph across all time.
   - Force layout. Colour shows the community (Louvain clusters); size shows exposure.
   - Clicking a concept opens a card with its gloss, the pages that taught it, the expeditions it appeared in, and its neighbours.
   - A time slider replays the graph growing, which is a satisfying "look how much I've learned" moment.
   - **Never show the whole hairball by default.** Show the top N concepts and cull labels.
4. **Journal:** thread and expedition cards, newest first, plus a weekly digest. A thread card opens the **thread page**: sessions on a timeline, plus the living note (§4.7).
5. **Search and Ask:** hybrid keyword and semantic search over pages, concepts and notes. "Ask" answers from your own pages and cites them.

**Export:** continuous sync to an **Obsidian vault**. The companion (§6.1) writes the files, and only inside the folder you choose. Each expedition and each concept gets its own note, with `[[wikilinks]]` and frontmatter. Obsidian's graph view then becomes a second view for free. Markdown zip and JSON dump exports are also available.

## 6. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Extension framework | **WXT** (TypeScript, Vite, MV3) | Hot reload; builds for Chrome and Firefox from one codebase |
| Tooling | **Bun** for everything: package manager, scripts, `bun test`, and the companion's runtime and compiler | One fast tool across the repo |
| UI | React 19 + **[Astryx](https://github.com/meta/astryx)** (Meta's design system, in beta) for components, templates and theming. **Tailwind v4** for any custom styling, using the Tailwind classes Astryx maps to its design tokens. No hand-written CSS files and no hard-coded colours. | One system for components, theming and dark mode. The Astryx plugin and CLI give coding agents UX guidance. |
| Storage | **IndexedDB via Dexie** (`unlimitedStorage`) | Simple and local. Brute-force cosine search is fine up to about 50k pages with int8 vectors; move to SQLite-WASM later if needed |
| Text extraction | `@mozilla/readability` | Mature; it's the engine behind Firefox reader view |
| Embeddings | **transformers.js** in an offscreen document, with a small model (e.g. all-MiniLM-L6-v2, 384-d) | Local, free, uses WebGPU with a WASM fallback |
| Keyword search | MiniSearch, fused with vector results via RRF | Tiny and in-browser |
| Graph data and algorithms | **graphology** (Louvain, metrics) | Shared by both views |
| Trail view | **React Flow + elkjs** (layered layout) | Readable cards, good for DAG-shaped trails |
| Atlas view | **Sigma.js** (WebGL) | Handles thousands of nodes smoothly. It draws on a canvas, so read node colours from Astryx's CSS variables at runtime to follow the theme and dark mode. |
| Background work | Job queue persisted in IndexedDB, driven by `chrome.alarms`; heavy work runs in an offscreen document | The MV3 service worker can be killed at any time, so every job must be resumable and idempotent |
| LLM | Provider interface with four providers: **Sign in with ChatGPT** (uses your plan), Anthropic API (your own key), Ollama (local), and Chrome's built-in on-device model where your hardware supports it. The first three run in the companion, so credentials never enter the browser. One shared output validator (Zod) checks every provider's JSON. | Lets you trade quality, cost and privacy per task |
| Local companion | Native Messaging host written in TypeScript and compiled to one binary with `bun build --compile`. Lives in the same repo as the extension and shares its Zod message schemas. | See §6.1 |

**Project setup (first step of M0)**
1. Run `bunx wxt@latest init` with the React template and Bun as the package manager.
2. Add Astryx:
   - `bun add @astryxdesign/core @astryxdesign/theme-neutral @stylexjs/stylex`
   - `bun add -d @astryxdesign/cli`, at the same version as core
   - then `bunx astryx init`, which writes the Astryx guide into the project's `AGENTS.md` and `CLAUDE.md`.
3. Add Tailwind v4 through `@tailwindcss/vite` in WXT's `vite` config.
   - In the CSS entry file, put Astryx's `@layer` order line **above** the Tailwind imports, then import `@astryxdesign/core/tailwind-theme.css`.
   - Astryx's docs warn that a `@layer` line below the Tailwind import silently reverses which styles win (`astryx docs styling-libraries/tailwind`).
4. Start each page from an Astryx template (`astryx build "<what the page is for>"`) instead of from scratch.

### 6.1 Local companion (the only backend)

Sign-in needs something that can receive a redirect and keep secrets safe, and an extension is bad at both. So Trailmap comes with a small **companion program that runs on your computer**. There is no hosted server.

**How the extension talks to it: Chrome Native Messaging.** Not a custom URL scheme, and not a localhost web server.
- **Install:** the companion writes a small JSON manifest into the browser's `NativeMessagingHosts` folder. On macOS, Chrome's folder is `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. The manifest contains:
  - the name `com.trailmap.companion`;
  - the absolute path to the binary;
  - `"type": "stdio"`;
  - `"allowed_origins": ["chrome-extension://<trailmap-id>/"]`.
- **Other browsers:** Brave, Edge, Arc and other Chromium browsers each have their own folder, so `trailmap-companion install` writes to every one it finds. Firefox works the same way but uses `allowed_extensions`, so a Firefox port isn't blocked.
- **Connecting:** the extension calls `chrome.runtime.connectNative("com.trailmap.companion")`. Chrome starts the binary, and the two exchange length-prefixed JSON over stdin/stdout.
  - Messages go both ways.
  - No port is opened and the user sees no prompts.
  - Only the extension ID listed in the manifest can connect.
  - An open native connection also keeps the MV3 service worker alive.
- **Limits:** a message from the companion can be at most 1 MB. That's plenty for model output; split anything bigger into pages.
- **During development,** set `key` in the extension manifest. Otherwise the ID of the unpacked extension changes and stops matching `allowed_origins`.

**Why not a custom protocol handler (`trailmap://`)?**
1. **OpenAI decides which redirect addresses it accepts,** and its docs show only loopback (`http://127.0.0.1:<port>/…`). A `trailmap://` redirect might be refused; you'd have to test it. Once there's a companion, loopback works anyway.
2. **It only goes one way.** A link can launch the app, but the app can't reply to the extension through it. You'd still need a second channel for every model call.
3. **It's noisy and easy to abuse.**
   - Chrome asks "Open Trailmap?" before handing a link to an external app.
   - Any website can fire `trailmap://` links at your app.
   - Any other app can register the same scheme.
   - On macOS the handler must be an `.app` bundle that declares the scheme in `Info.plist`, not a plain binary.

Keep it as a fallback only, in case OpenAI ever accepts custom schemes and loopback stops working.

**Why not a localhost HTTP API?** The extension could call one, but so could web pages and every other local process. You'd have to add tokens, Origin checks and DNS-rebinding defences. Native Messaging avoids all of that. The companion opens a loopback port only for the minute or so of sign-in (§7.1, step 3).

**What the companion does.** Keep this list short.

| Message | What it does |
|---|---|
| `auth.signIn` / `auth.status` / `auth.signOut` | Open an authorize URL, read the account status, or end the session (§7.1). The companion pushes `auth.completed` when sign-in succeeds. Tokens stay in the companion. |
| `keys.set` / `keys.status` | Saves the Anthropic API key to the companion's secret store and reports whether a key is saved. The extension does not persist the key; the companion never returns it. |
| `llm.models` | Lists displayable `{ provider, slug, displayName }` models from all connected providers. Reports provider status separately so an unavailable provider doesn't hide the other catalogs. |
| `llm.complete` | Takes `{ provider?, task, model?, instructions, input, schema, schemaName }`. The prompt and input are strings; pass a JSON Schema 2020-12 object (e.g. from Zod). Returns `{ output }` only after validation, or a typed error. |
| `vault.write` | Writes a Markdown file, only inside the chosen Obsidian folder. |
| `vault.remove` | Removes a stale generated Trailmap note after Forget or reconciliation, only in the pinned Obsidian folder. Accepts only generated flat Markdown filenames, refuses symlinks and folder changes, and removes the file only if its digest matches the last generated content. |

- **No general-purpose commands.** There is nothing like "fetch any URL" or "read any file", so a bug in the extension can't turn the companion into a general proxy. Every incoming message is checked against the shared Zod schemas.
- **Secrets** live in the macOS Keychain. The `security` command-line tool is enough for the prototype.
- **Browsing data stays in the extension.** Visits, pages and the graph remain in IndexedDB. Moving them into SQLite in the companion is possible later, but not needed now.
- **The extension still works without the companion.** Capture, trails and expeditions run without it, and so does Chrome's on-device model. Cloud and Ollama AI features and Obsidian sync need it.
- **Distribution:** sharing the binary beyond your own machine means code-signing and notarizing it on macOS. For a personal prototype, building it locally avoids that.

## 7. LLM options and cost

Assumed volume: about 50 enriched pages a day (about 3k tokens in and 500 out each), plus about 3 field-note syntheses a day (about 20k in and 2k out each). That totals roughly **6.6M input and 1M output tokens a month**.

| Option | Price (in / out per 1M tokens) | ≈ Monthly cost | Notes |
|---|---|---|---|
| **ChatGPT plan** via Sign in with ChatGPT (§7.1) | Included in Plus / Pro | **$0 extra**, within the weekly per-app cap you set | No API key needed. Page text goes to OpenAI. No batch discount, so the queue has to budget against the cap |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 / $0.50 | **≈ $1–2** | Fine for per-page extraction |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 / $10 | ≈ $25 | Better concept merging and notes |
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 / $20 | ≈ $50 | Best synthesis |
| Ollama with a local 7–8B model | $0 | $0 | Fully private. Weaker at merging and at following the JSON schema |
| Chrome on-device model | $0 | $0 | Fully private. Small context; depends on hardware |

- **Make the model configurable per task.** Use one setting for per-page extraction and another for field notes and merge decisions. That way you can put a cheap model on the high-volume step and a strong one on the step you actually read.
- **Batch the work that isn't urgent.** Per-page enrichment can run through the Message Batches API at 50% off. Field notes don't need to be instant.
- Use structured outputs (`output_config.format`) with the JSON schema in §4.4, at low effort for extraction. Thinking tokens add somewhat to the output figures above.

### 7.1 Sign in with ChatGPT (use your ChatGPT plan instead of an API key)

- Eligible **Plus and Pro** subscribers set a weekly usage cap for each app. Plus also has a five-hour limit shared across apps. ChatGPT Settings → Usage shows the user's caps and credit settings. [OpenAI accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage)
- Trailmap uses the public client flow for open-source and locally hosted apps. It uses dynamic registration without a client secret. Paid or hosted integrations use OpenAI's interest form. [OpenAI open-source integration overview](https://developers.openai.com/siwc/token-sharing-open-source)

**Sign-in flow**

1. In onboarding or the side panel, the user clicks **Continue with ChatGPT**. The extension sends `auth.signIn` and opens the companion's authorize URL in a normal tab.
2. The companion starts a loopback listener at `http://127.0.0.1:1455/auth/callback`, with a free port as a fallback. The scheme, IP and path stay fixed from first registration onward. The same complete redirect URI goes into the authorize request and code exchange.
   - Send `GET https://auth.openai.com/api/accounts/authorize` with `response_type=code`, PKCE `S256`, fresh `state` and `nonce`, and the installation's stable `ext_agent_host_id=urn:uuid:<uuidv4>`.
   - Request `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` and `resource=https://api.openai.com/v1`.
   - The first registration sends `client_id=dynamic_agent_client` and `agent_name_hint=Trailmap`. The callback supplies the issued `oaiapp_…` client ID. Returning sign-ins reuse that registration and can send a verified email as `login_hint`. OpenAI also supports a retained `id_token_hint` to skip account selection. Trailmap uses the documented account-selector flow to keep the ID token out of the extension and browser.
3. Validate the callback's `state` before processing its result. A state-matched OAuth error ends the attempt. Enforce one exchange per attempt. For a returning sign-in, reject a callback that supplies a different client ID.
   - POST a form-encoded `authorization_code` grant to `https://auth.openai.com/api/accounts/oauth/token` with the issued client ID, code, verifier, exact redirect URI and resource.
   - Verify the ID token against the issuer's discovery JWKS and check the issuer, audience, expiry and nonce. Use its verified subject as the account identity. Check that a returning account matches the registration before replacing credentials. Treat email as verified only when the token marks it verified.
   - Store the validated identity, installed client ID, tokens and expiry in the companion's secret store. Derive account status from the token response's granted scopes. Keep the sign-in with plan usage off if `chatgpt.tokens.use.direct` is absent. An explicit attempt to enable the grant requests consent with the complete scope set.
   - Close the listener, show "Signed in. You can close this tab.", and emit `auth.completed`. The listener also closes after timeout, cancellation or a failure on the matched callback.

[OpenAI registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) · [OpenAI ID-token validation](https://developers.openai.com/siwc/website#6-verify-the-id-token)

**Token handling**

- Access tokens last one hour. Refresh tokens last 30 days and rotate after each successful refresh. Refresh near expiry with a form-encoded `refresh_token` grant that sends the issued client ID, current refresh token and resource, and omits `scope`. Serialize refreshes and replace the saved credential set together.
- Clear unusable credentials on `invalid_grant`, `invalid_refresh_token`, `token_expired`, or `refresh_token_*` from refresh. Sign in again with the saved client ID. Preserve credentials on temporary failures and check the configuration on `invalid_client`. A confirmed disconnect also requires a fresh sign-in.
- On sign-out, discover the issuer's `revocation_endpoint` and POST the refresh token, `token_type_hint=refresh_token` and issued client ID as form fields. Retry temporary failures with bounded backoff. Clear local access, refresh and ID tokens while retaining the account/client mapping and stable host ID. Tell the user when revocation could not be confirmed and point them to ChatGPT Settings.
- Store tokens in the macOS Keychain or the companion's owner-only file store. The extension receives only the URL to start sign-in, lifecycle notifications and account status. The companion provides fresh access tokens to its inference callers.

[OpenAI session management](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) · [OpenAI token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference) · [OpenAI refresh errors](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery#refresh-errors)

**Inference and structured output**

- Call `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <access_token>`. Use `store: false`, `stream: true` and an array for `input`. Put instructions in `instructions` or developer messages. The route rejects system-role items and fields such as `max_output_tokens`, `temperature` and `previous_response_id`. Budget prompt size locally and follow OpenAI's supported input and tool lists. [OpenAI preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- Read the account's catalog from `GET /v1/models`, keeping entries with `visibility == "list"` in server order. Until per-task model settings exist, use the first listed slug when `model` is omitted. Treat only `response.completed` as success. Handle `response.failed`, `response.incomplete`, explicit errors and interrupted streams. For example, a usage limit can arrive as `response.failed` after streaming starts. [OpenAI models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- Try JSON Schema via `text.format`. Plan usage support for this format is unconfirmed. If `subscription_sharing_unsupported_capability` identifies the `text` format in `error.param`, ask for JSON in the prompt and allow one repair attempt if that output is invalid. In both paths, the companion validates against the caller's JSON Schema before returning the output; task callers can additionally check their Zod schema.
- **Summarize this page** runs only on click. It uses the active tab's current Visit to read the Page's stored text, sends only that text as the source, and shows a summary and takeaways in the side panel. It does not re-extract text or write enrichment fields to the Page.

**Errors the UI must handle**

Before the stream opens, the response may carry a `detail` field. Use the HTTP status for recovery and retain the request ID for diagnosis. A 401 calls for checking identity and grants, a 403 for checking serving policy or region, and a 503 for bounded backoff. [OpenAI errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

`@trailmap/shared` exports `LlmErrorCode`. Both model verbs use these stable codes in the companion error reply. `CompanionRequestError` exposes `code` and `details` (optional `requestId` and `retryAfterMs`). Other transport errors, such as `not_connected`, are separate. The companion never includes raw provider messages, page text or credentials in error replies or logs.

| Provider condition | Trailmap code and recovery |
|---|---|
| `subscription_sharing_user_not_eligible` (403) | `not_eligible`: stop plan requests. Explain the plan, workspace or policy restriction; do not retry or loop through OAuth. |
| `subscription_sharing_usage_limit_exceeded` (429) | `usage_limit_exceeded`: pause new plan requests and link to ChatGPT Settings → Usage. Preserve the queue and do not guess which cap applied or when it resets. |
| `subscription_sharing_usage_unavailable`, `subscription_sharing_user_unavailable`, a temporary OAuth or transport failure, or a stream ending before completion | `usage_unavailable`: keep credentials and retry later with bounded backoff (the error includes a 5-second initial hint, not a reset time). |
| `subscription_sharing_unsupported_capability` (400) | Fall back only for `text` per `error.param`. Otherwise `provider_rejected`: change the request before trying again. |
| `subscription_sharing_route_not_supported` (403) | `provider_rejected`: verify the HTTP method and endpoint. |
| `subscription_sharing_invalid_user` (401) or direct admission 401/403 | `provider_rejected`: check account, grant, policy or region; keep credentials unless a disconnect or terminal refresh failure is confirmed. |
| `chatpass_v2_scope_not_authorized` or `chatpass_v2_invalid_authorization_context` (403) | `provider_rejected`: check client configuration and grants; do not silently switch billing. |
| `chatgpt.tokens.use.direct` absent | `plan_usage_not_granted`: show plan usage as off and offer explicit reauthorization or another provider. |
| No session or terminal refresh failure | `not_signed_in`: sign in again using the saved client registration if present. |
| Refusal, incomplete response, or output that fails JSON or schema validation | `invalid_output`: do not present the output as a success. |

**Budgeting against plan limits.** Run `read` page enrichment first, then field notes, then `skimmed` page enrichment when there's room, and concept-merge verdicts last. Link to ChatGPT Settings → Usage for app usage and credit settings.

## 8. Privacy and permissions

- **Everything stays local.** There is no hosted backend; the only backend is the companion on your computer (§6.1). The only thing that leaves the machine is text from filtered, engaged pages, sent to the LLM you choose. A "sent to model" log shows exactly what went out.
- **Forget controls:** forget a page, an expedition or a site. This is a hard delete and also removes the evidence it contributed to concepts.
- **Permissions needed:** `<all_urls>` host access, `webNavigation`, `tabs`, `history`, `idle`, `storage`, `unlimitedStorage`, `sidePanel`, `offscreen`, `alarms`, and `nativeMessaging` (to talk to the companion).
  - For personal use, load it unpacked; no store review is needed.
  - Publishing to the Chrome Web Store with `<all_urls>` and `history` means extra review and a privacy policy.
- **Credentials** (ChatGPT tokens and API keys) live in the companion, in the macOS Keychain. The browser never stores them.
- **The companion only accepts Trailmap.** Native Messaging only lets the extension ID in its manifest connect. The companion offers a short, fixed set of commands with no general fetch or file access. It opens a loopback port only during sign-in.

## 9. Milestones

| # | Scope | Exit test |
|---|---|---|
| **M0: Spike** (a weekend) | Project setup (§6: Bun, WXT, Astryx, Tailwind). Capture navigation and Readability text into IndexedDB. Render yesterday's raw trail with React Flow. No LLM. | Looking at yesterday's raw trail already feels useful, or teaches you why it doesn't. |
| **M0.5: Companion spike** (1–2 days) | A Native Messaging "hello world" and the `install` command. ChatGPT sign-in over loopback, with tokens in the Keychain. One streamed `/v1/responses` call that summarizes a page, trying JSON-schema output. | From the extension you can sign in, refresh the token, and get a structured summary back, without a token ever showing up in the browser. |
| **M1: Expeditions** (1–2 wks) | Engagement scoring, filters, local embeddings (segmentation needs them), segmentation, side panel live trail, manual merge and split. | At least 80% of your expeditions look right without manual fixes. |
| **M2: Notes** (2 wks) | LLM provider layer in the companion (ChatGPT sign-in, Anthropic key, Ollama), a queue that respects the weekly cap, per-page enrichment, expedition titles and questions, field notes, Obsidian export. | **You stop wanting to take notes by hand.** Use it daily for 2 weeks before going further. |
| **M3: Threads and Atlas** (2–3 wks) | Threads (matching, living notes, the "picking up" card, the thread page), concept resolution, Atlas view, hybrid search. | Coming back to a topic after a few days lands in the same thread, and clicking a concept answers "where did I learn this?" correctly. |
| **M4: Depth** (ongoing) | History backfill, YouTube transcripts, PDFs (pdf.js), Reddit/HN thread extractors, weekly digest, Ask, Firefox build, optional spaced-repetition review of concepts. | — |

## 10. Hard parts, ranked

1. **Segmentation quality.** If expeditions are wrong, everything downstream is wrong, and the same goes for linking expeditions into threads. Build the correction UI early and log every correction.
2. **Concept soup.** Duplicates, over-general concepts and one-off mentions. Under-extract, require evidence, and merge in batches.
3. **The hairball.** Graphs look magical with 30 nodes and useless with 3,000. The expedition is the main unit; the Atlas is filtered by default.
4. **Extraction gaps.** Single-page apps, paywalls, PDFs, videos and infinite-scroll threads each need their own extractor over time.
5. **MV3 lifecycle.** The service worker gets killed, so the job queue must be idempotent and resumable.
6. **Cloud LLM trade-off.** Cost and privacy. Mitigated by filtering, batching and a local-model option.
7. **Two things to install.** You install both the extension and the companion.
   - The companion's manifest has to go into each Chromium browser's folder.
   - The extension ID must stay fixed.
   - A binary shared beyond your own machine needs signing on macOS.
   - Structured output isn't documented for plan usage.
   M0.5 tests all of this before anything depends on it.
8. **Scope creep.** Agent memory, accounts and sharing are tempting and already listed as non-goals (§2). Keep them there.

## 11. Decisions for you

1. **Browser:** Chromium only (Chrome, Arc, Brave, Edge, Phi), or Firefox too? This plan assumes Chromium first; WXT keeps Firefox cheap to add later.
2. **LLM:** ChatGPT plan via sign-in (needs Plus or Pro), a Claude API key, fully local (Ollama), or a mix? Which model do you want for extraction, and which for notes?
3. **Where notes live:** only inside the extension, or synced into Obsidian or Logseq?
4. **Audience:** a personal tool, or something you'd publish? This changes how much polish, permission justification and store review you take on.
