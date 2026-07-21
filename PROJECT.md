# Signergy — Project & Architecture Reference

Signergy is a **Manifest V3 browser extension** (Chrome / Firefox) that adds a
**real-time sign-language overlay** to YouTube and Google Meet. It reads the
live captions already present on the page, matches that text against a
dictionary of pre-recorded sign videos, and plays those videos in a small
draggable floating box — giving Deaf and Hard-of-Hearing users signing for
spoken content without special hardware or a human interpreter.

**Core idea in one sentence:** *scrape the captions → match text to sign videos → play them in order in an overlay.*

---

## 1. File map

| File | Role |
|---|---|
| `manifest.json` | Extension config: permissions, target sites, entry points. |
| `content.js` | **The engine.** Injected into each YouTube/Meet page. Handles caption reading, matching, queueing, and playback. |
| `dictionary.json` | The data. Maps normalized text → video filenames. Bundled in the extension. |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup UI: Enable overlay, Show filename (debug), Reload overlay. |
| `background.js` | Service worker — **currently legacy/unused** (see §6). |
| `Signergy.png`, `0.png` | Icons. |

### How the pieces talk to each other
- **popup.js → content.js** via `browserApi.tabs.sendMessage()`. Toggling a
  control sends a message (`enableOverlay`, `disableOverlay`, `toggleDebug`,
  `reloadOverlay`) to the content script in the active tab.
- **Settings** persist in `browserApi.storage.sync` (`isOverlayEnabled`,
  `showDebug`) — survives reloads and syncs across the user's Chrome profile.
- **content.js → GitHub**: sign videos are **not** bundled; they are fetched at
  runtime from a public repo via `raw.githubusercontent.com`.

---

## 2. Execution flow (step by step)

When a YouTube page loads:

1. **Injection** — `manifest.json`'s `content_scripts` block injects `content.js`
   into `youtube.com`, `m.youtube.com`, and `meet.google.com` at `document_idle`.

2. **Startup (`main()`)**
   - Reads saved settings from `storage.sync`.
   - If enabled, `initializeOverlay()` builds the floating `<div>` (fixed,
     bottom-right, draggable via combined mouse + touch handlers) containing a
     hidden `<video>` and a debug text line.
   - Fetches `dictionary.json` via `browserApi.runtime.getURL(...)` (this is why
     the manifest lists it under `web_accessible_resources`).
   - Starts the caption watchdog (`startCaptionWatch()`).

3. **Finding & watching captions** (`startCaptionWatch` → `findCaptionContainer`
   → `attachObserver`)
   - Every 1 s it looks for the site's caption container
     (`.ytp-caption-window-container` on desktop YouTube; separate selectors for
     mobile YouTube and Meet).
   - When found, it attaches a **`MutationObserver`** that fires whenever the
     caption DOM changes.
   - The watchdog **re-attaches** the observer whenever the caption node is
     rebuilt (YouTube and other extensions frequently replace it). The original
     one-shot observer silently died when that happened.

4. **Reading new text (`handleTranscript`)**
   - The observer callback is **debounced 750 ms** so captions settle before
     processing (avoids choppy half-word matching).
   - Reads the full caption text, diffs it against `transcriptHistory`, and
     extracts only the **newly added** portion (`startsWith` + `substring`).

5. **Matching — three-tier fallback (`processNewText`)** — the key design:
   - **Tier 1 — Sentence:** if the caption contains a full phrase from
     `dictionary.sentences` (longest match preferred), play one fluid
     sentence-level sign video.
   - **Tier 2 — Word:** otherwise split into words, look each up in
     `dictionary.words`.
   - **Tier 3 — Fingerspelling:** any word not in the dictionary is spelled out
     letter-by-letter via `dictionary.letters` (all 26 exist) → **100% coverage**.

6. **Queueing (`addSignToQueue`)** — each match becomes
   `{key, fileName, url, category}` pushed onto `signQueue`. URL pattern:
   ```
   https://raw.githubusercontent.com/Adityaa-Kumar/Signergy/main/Signergy/Signs/<category>/<fileName>
   ```

7. **Sequential playback (`displayNextSign`)** — a self-chaining loop plays one
   video at a time:
   - Sets `signVideo.src`, waits for `loadeddata`, plays at **2.5× speed**.
   - Advance timing: letters at **0.5× duration** (fingerspelling overlaps
     slightly to stay fast); words/sentences at **full duration + 200 ms**.
   - `onVideoError` skips a failed clip so the queue never stalls.
   - Empty queue → after 2 s shows "Waiting for captions...".

8. **Pause synchronization** — hooks the host YouTube `<video>` and mirrors its
   play/pause state: pausing the video freezes the current sign and stops the
   queue timer (saving remaining time); resuming continues from where it left
   off. A 1 s reconcile loop guarantees the pause state can never get stuck.

---

## 3. Key design decisions

- **`MutationObserver` over polling** — event-driven, reacts only when captions
  actually change.
- **Three-tier fallback** — balances naturalness (sentences) against universal
  coverage (fingerspelling safety net).
- **A queue** — decouples matching from playback so bursty captions never cause
  signs to overlap or drop.
- **Remote video hosting** — ~1,372 clips would bloat the package and hit store
  size limits; remote hosting keeps the extension tiny and lets the video
  library update without republishing. Trade-off: network/GitHub dependency and
  subject to the page's Content Security Policy.

---

## 4. The sign library

Exact counts from `dictionary.json`:

| Category | Count |
|---|---|
| Sentences | 247 |
| Words | 1,099 |
| Letters | 26 |
| **Total clips** | **1,372** |

**Structure & conventions:**
```json
"sentences": { "what happened": "1.mp4", ... }   // numeric IDs
"words":     { "america": "America.mp4", ... }    // human-readable
"letters":   { "a": "a.mp4", ... }
```
- Dictionary **keys are lowercase** (case-insensitive matching); **filenames
  preserve original casing** (`America.mp4`).
- The word list skews heavily toward **proper nouns / geography** (Afghanistan,
  Africa, America, Australia…), so everyday conversational words often fall
  through to fingerspelling.

**Licensing note:** the clips' provenance is **not documented** in this repo (no
license file or attribution). The vocabulary pattern suggests they were
collected from existing ASL resources (e.g. Handspeak, Signing Savvy,
ASLU/Lifeprint, WLASL) — several of which restrict redistribution. **Verify
provenance before any public/commercial release**; for production, license a
dataset with clear redistribution rights, partner with a Deaf-community org to
record originals, or use openly-licensed clips with attribution.

---

## 5. Adding vocabulary

The design is data-driven — **no code changes needed**:

1. **Record/obtain** the sign clip as `.mp4` (match existing resolution/framing).
2. **Upload** it to the GitHub repo under the right folder, e.g.
   `Signergy/Signs/words/Hello.mp4`.
3. **Add one line** to `dictionary.json` (lowercase key, exact filename value):
   ```json
   "words": { "hello": "Hello.mp4" }
   ```
4. Reload the extension to pick it up.

At scale, write a script that scans the `Signs/` folders and auto-generates
`dictionary.json` from filenames so the data file stays in sync.

---

## 6. Known issues / improvement backlog

- **Dead `background.js` code path** — it fetches videos from **Google Drive**
  and converts them to blobs, but the content script never calls it (it loads
  directly from GitHub). Leftover from an earlier architecture, likely an attempt
  to bypass CSP. Should be removed or repurposed.
- **Manifest mismatch** — `host_permissions` grants `raw.githubusercontent.com`
  (what's actually used), while `background.js` references `drive.google.com`.
- **Match performance** — the sentence matcher scans every sentence key on each
  caption (O(captions × sentences × length)); fine at 247, needs indexing at
  scale.
- **No lemmatization** — "run/runs/ran" are distinct keys; misses inflections.
- **Timing drift** — fast speech can outrun the 2.5× queue, so signs lag.
- **Caption fragility** — entirely dependent on scraping caption DOM, which the
  target sites change periodically.

---

## 7. Scaling challenges (beyond just adding JSON entries)

1. **Sourcing clips is the real bottleneck** — every word needs a real signed
   video; recording at scale needs a fluent signer + consistent production, and
   scraping reintroduces licensing risk.
2. **Sign language ≠ word-for-word English** — ASL has its own grammar and word
   order; naive one-sign-per-word concatenation is not fluent signing. Quality
   needs phrase/sentence-level translation (why Tier 1 exists).
3. **Matching degrades with size** — substring scan cost, no stemming, no
   homograph/context disambiguation ("bat" = animal vs. baseball).
4. **Timing/sync** — more matches mean more to play; the queue lags further
   behind fast speech. Needs drop/skip strategies.
5. **Library consistency** — mixed resolution/framing/signers look disjointed at
   scale; needs a production standard.
6. **Delivery** — thousands of clips with many users needs a CDN + caching;
   `raw.githubusercontent.com` has rate/bandwidth limits.

**Long-term direction:** past a certain scale, stop mapping text→clips and move
toward a **gloss-based translation model with a signing avatar**.
