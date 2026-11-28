# Forum thread fixtures

Local reconstructions of the DOM shapes Trailmap's extractor (`capture/forum.ts`) looks for on old Reddit, new Reddit (shreddit) and Hacker News. **They are not copies of the live pages.** On 2026-11-28 a signed-out headless run against a live new Reddit thread and a live Hacker News item confirmed the extractor reads both (`reddit-new-live.html` records the new Reddit shape it found); old Reddit now asks signed-out visitors to log in, so it is still unverified; the usernames, posts and comments are synthetic.

The Chromium tests fulfil `https://old.reddit.com/**`, `https://www.reddit.com/**` and `https://news.ycombinator.com/**` from these files with `context.route`, because the capture and deny-list rules key on the real host names. No request leaves the machine.

| File | Stands for | Shape the extractor reads |
|---|---|---|
| `reddit-old.html` | old Reddit thread | `#siteTable > .thing.link[data-fullname=t3_<id>]` (`p.title > a.title`, `.expando .usertext-body .md`); `.commentarea .thing.comment` with its own `.entry .usertext-body .md`, depth = enclosing `.thing.comment` count |
| `reddit-new.html` | new Reddit thread | one `shreddit-post[id=t3_<id>]` (`[slot=title]`, `[slot=text-body]`); `shreddit-comment[depth]` with its own `[slot=comment]` child |
| `reddit-new-live.html` | new Reddit thread, live layout | as above, but the post body is `shreddit-post-text-body[slot=text-body]` with a "Read more" button, and each comment's `[slot=comment]` sits inside `details > div > div` (structure observed live on 2026-11-28; text synthetic) |
| `hn-item.html` | Hacker News item | one `table.fatitem tr.athing#<id>` (`.titleline > a`, `.toptext`); `table.comment-tree tr.athing.comtr` with `td.ind[indent]` (or the spacer image width / 40) and `.commtext` |
| `reddit-feed.html` | a subreddit feed | never captured, even after the opt-in |
| `unknown-layout.html` | a thread in a layout nobody documented | yields no capture |

Authors, `u/name` / `/user/name` / `user?id=name` links and plain `u/name` mentions are all named in these files so tests can prove none survives. Deleted, removed and flagged comments, the sidebar, and "load more comments" controls are included so tests prove they stay out.
