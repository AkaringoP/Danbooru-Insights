# Danbooru Insights

![license](https://img.shields.io/badge/license-MIT-green)
![typescript](https://img.shields.io/badge/typescript-✓-blue)
![platform](https://img.shields.io/badge/platform-Userscript-orange)
![build](https://img.shields.io/badge/build-Vite-646CFF)
![version](https://img.shields.io/badge/version-9.7.1-blueviolet)

**Danbooru Insights** (formerly **Danbooru Grass**) is a comprehensive analytics suite for Danbooru users and tags. It injects GitHub-style contribution graphs and advanced dashboards directly into profile, wiki, and artist pages — no account-level requirements, no Gold-only features, works for everyone.

The script consists of three main components:
* **GrassApp**: Visualizes user contributions (Uploads, Approvals, Notes) on a GitHub-like calendar heatmap with hourly activity analysis, 12 themes, and selectable grass color palettes.
* **UserAnalyticsApp**: Deep insights into a user's posting habits — milestones, tag usage, tag cloud, created tags discovery, post scores, and 11 distribution pie chart tabs.
* **TagAnalyticsApp**: A specialized dashboard for Artist, Copyright, and Character tags — historical trends, popular posts, active uploaders/approvers, and milestones for any specific tag.

## Examples
#### GrassApp
<img width="1365" height="404" alt="GrassApp" src="https://github.com/user-attachments/assets/a4c0bf04-0adf-4ebc-92c6-7123a693e237" />

#### UserAnalyticsApp
<img width="706" height="500" alt="UserAnalyticsApp 1" src="https://github.com/user-attachments/assets/30116ec5-497a-471e-bff5-9fb9a48baa41" />
<img width="706" height="525" alt="UserAnalyticsApp 2" src="https://github.com/user-attachments/assets/9ce42888-1f12-4b15-90bf-be2809d1b5b5" />

#### TagAnalyticsApp
<img width="608" height="685" alt="TagAnalyticsApp 1" src="https://github.com/user-attachments/assets/981b57c3-bb01-423b-927c-8a5f5a17d55b" />
<img width="564" height="551" alt="TagAnalyticsApp 2" src="https://github.com/user-attachments/assets/a66065f8-87cc-4d3e-9772-953ee037871e" />

---

## Features (v9.6)

### Grass / Contribution Graph
* **3 metrics**: Uploads, Approvals, Notes — switch via the metric selector in the graph header. Clicking a cell jumps to the corresponding Danbooru search (e.g. Notes cell → `/note_versions` filtered by updater + date).
* **Hourly activity heatmap**: Click the clock icon to overlay a 24-hour distribution showing what time of day the user is most active.
* **Resizable / movable layout**: Drag the corner handle to resize, drag the header to reposition (inline vs below the profile stats). Per-user settings persist in IndexedDB.
* **12 themes × 4 grass color palettes each**: 48 color combinations. Each theme remembers its own grass color.
* **Customizable thresholds**: Manual thresholds or one-click auto-tune (percentile-based, with a preview modal showing per-row source — `P40` / `P70` / `P90`).
* **Approval detail popover**: Click an approval cell to see the exact post IDs approved that day, with thumbnails on hover.

### User Analytics Dashboard
Open via the **📊 Button** next to the username.

* **Live loading progress** (v9.6): real-time phase counter (`Loading dashboard · N/14`) plus rotating substatus showing what the data layer is currently doing.
* **Pie Chart (11 tabs)**: Copyright, Character, Favorite Copyright, Status, Rating, Commentary, Translation, Gender, Breast Size (NSFW-gated), Hair Length, Hair Color.
  * **Sub-chart mode** (v9.6, Copy / Fav_Copy / Char): Hover (desktop) or tap (mobile) a legend row — the pie redraws to show the parent's sub-tag breakdown, with a tooltip listing percentages and `/posts?tags=user:...+sub_tag` links.
* **Tag Cloud (4 category tabs)**: d3-cloud word cloud showing user's most characteristic tags per category (General / Artist / Copyright / Character).
  * **Signature filter** (v9.6): the General tab drops the 50 most-frequent site-wide tags *unless* the user uses them at a notably above-average rate (Lift ≥ 2.0). Result: your cloud shows tags actually characteristic of *your* work — not the same `1girl` / `simple_background` everyone has.
  * **Unlocks at 100 uploads** — below the threshold a progress placeholder is shown instead.
* **Created Tags**: discovers general tags created by the user (via NNTBot forum reports). Status indicator: Active / Aliased / Deprecated / Empty. Lazy-loaded.
* **Scatter Plot — Score / Tag Count mode**:
  * Hover any dot for a thumbnail preview (with score, favs, artist/copy/char metadata).
  * Drag to range-select; a popover lists the matched posts.
  * Score mode: filter by downvote count (`>0`, `>2`, `>5`, `>10`).
  * Tag Count mode `Y=10` click: jump to posts with fewer than 10 tags (general or total).
  * Adaptive grid density (v9.6): Y-axis step picks the nicest round value relative to the max, so small and large users see consistently ~6 grid sections.
  * **Unlocks at 300 uploads** — placeholder otherwise.
* **Milestones**: configurable target ladder (Auto / Every 1k / 2.5k / 5k / 10k / Repdigit 111-11111). The "Next Milestone" card shows progress to the upcoming target.
* **Top Posts / Recent Popular / Random Post**: thumbnail cards. All now filter to `status:active` (v9.6) so banned/deleted posts don't surface as blank cards.
* **Count refresh TTL** (v9.6): the dashboard's count-driven distributions (status, rating, tag distributions, etc.) auto-refresh after a configurable window (default 10 min, user-settable). Previously these were "trust until reset" — could go arbitrarily stale.

### Tag Analytics Dashboard
Visit any Wiki page (`/wiki_pages/TAG_NAME`) or Artist page (`/artists/NUMERIC_ID`) — the dashboard appears automatically.

* **History chart**: monthly post counts going back to the tag's first appearance.
* **Top uploaders / approvers**: ranked tables with avatar + count, paginated.
* **Recent popular / Random post**: thumbnail cards (status:active filtered).
* **Milestones**: configurable target ladder per tag.
* **Small-tag optimization**: tags with ≤1,200 posts are fetched entirely into memory — instant render, no DB storage, no incremental sync overhead.

### Mobile Support
* **Responsive layout**: both dashboards fill the viewport (`100dvh`); widgets reflow under 768 px.
* **2-step tap interactions**: tooltip → action pattern for heatmap cells, pie slices, scatter dots, and tag cloud words.
* **Browser Back button**: closes open modals (via `history.pushState`).

### Theme System (12 Themes × 4 grass palettes = 48 combinations)
* **Light**: Light, Solarized Light, Sakura, Lavender, Ice, Aurora
* **Dark**: Midnight, Solarized Dark, Dracula, Ocean, Monokai, Ember
* **Grass Color Picker**: 4 selectable palettes per theme (Green, Blues, Purples, Oranges, Viridis, Plasma, Inferno, Magma, Turbo, …) inspired by d3-scale-chromatic. Per-theme memory — each theme remembers its own last-used grass color.
* **Auto mode**: follows Danbooru's own dark-mode toggle.

### Performance & Reliability
* **Rate-limited fetcher**: 9 req/sec, 8-concurrency token bucket with multi-tab coordination — stays under Danbooru's 10 req/s server cap even with multiple tabs open.
* **IndexedDB persistence**: post history, daily counts, piestats, and tag analytics cached locally. Quota-safe writes — least-recently-used non-current-user data is evicted on `QuotaExceededError`, never the current user's.
* **Persistent storage opt-in** (v9.4+): after first successful sync, requests `navigator.storage.persist()` to survive Safari ITP / Chrome heuristic eviction.

### Engineering
* **759 Vitest unit tests** + **7 Playwright e2e tests** (visual baselines for grass, pie widget, settings popover).
* **Architecture fitness tests**: layer-direction enforcement, raw `fetch()` ban, NSFW localStorage key consolidation, `/counts/posts.json` URL consolidation, popover-position formula consolidation.
* **Pre-commit hook**: `npm run build` → `npm run lint` → `npm run check:dead` (knip) chained. Blocks regressions before commit.

---

## Installation

1. Install a UserScript manager:
   * **[Tampermonkey](https://www.tampermonkey.net/)** (recommended — Chrome / Edge / Whale / Firefox / Safari)
   * Violentmonkey also works
2. **[Click here to install the latest release](https://github.com/AkaringoP/Danbooru-Insights/raw/build/danbooruinsights.user.js)**
3. Confirm the installation in your UserScript manager.

The script auto-updates from the GitHub `build` branch — new releases reach you without manual reinstall.

---

## Usage

### 1. Profile pages (GrassApp + UserAnalyticsApp)

Visit any user profile, e.g. `https://danbooru.donmai.us/users/701499` or your own `/profile`.

* The **Contribution Graph** appears automatically above the statistics section. Hover any cell for the date + count; click to jump to the matching Danbooru search.
* The metric selector (top-left of the graph) switches between **Uploads / Approvals / Notes**.
* The **⚙️ button** opens the settings popover — change theme, grass color, contribution thresholds, NSFW visibility, count-refresh interval, etc.
* The **📊 button** (next to the username) opens the **Analytics Dashboard** modal. Inside the dashboard:
  * Tab through the 11 pie chart categories at the top.
  * Scroll down for **Tag Cloud** (4 category tabs), **Created Tags**, **Scatter Plot** (Score / Tag Count modes), **Milestones**, **Top Posts**, **Recent Popular**, **Random Post**, and other widgets.
  * Click the gear icon in the dashboard header to adjust dashboard-only settings (sync interval, count refresh window, NSFW, etc.).
  * Press the browser **Back** button or click outside the modal to close.
* The graph supports drag-resize (corner handle) and drag-move (header). Inline vs below-stats layout is toggleable.

### 2. Tag pages (TagAnalyticsApp)

Visit any wiki or artist page:

* `https://danbooru.donmai.us/wiki_pages/TAG_NAME` (Wiki)
* `https://danbooru.donmai.us/artists/NUMERIC_ID` (Artist)

The dashboard appears below the page header automatically. You'll see:

* **History chart** — monthly post counts.
* **Top uploaders** / **Top approvers** ranked tables.
* **Popular posts**, **Random post** thumbnail cards.
* **Milestones** showing key post-count anniversaries.

### 3. Tips

* **First load is slowest** — the script fetches the user's full post history once, then caches in IndexedDB. Subsequent visits are near-instant; only deltas are fetched.
* **Multi-tab safe** — open the dashboard on multiple users in different tabs; the rate limiter coordinates so you stay under Danbooru's request cap.
* **NSFW toggle** — disabled by default. Enable in the settings popover to surface the Breast Size pie tab and related stats.
* **Mobile** — both dashboards work on phones/tablets; just visit the same URLs in mobile Chrome/Safari with a UserScript manager.
* **Tag Cloud / Scatter Plot are upload-gated** — they need a minimum of 100 / 300 uploads respectively to be meaningful. Below the threshold you'll see a progress placeholder, not the widget.

---

## Compatibility

* Tested on Chrome / Edge / Whale / Firefox with Tampermonkey. Safari should work with Userscripts.app or Tampermonkey for Safari.
* Requires `d3.v7`, `d3-cloud`, `cal-heatmap`, and `dexie.js` (automatically loaded via `@require` from jsDelivr).
* **Works on every account level** — every feature operates correctly on basic Member (Blue) accounts. No Gold-only search features (3+ tag queries) are used.
* `@grant none` — the script does not use any `GM_*` API, so it cannot read your Tampermonkey storage or make cross-origin requests outside `*.donmai.us`.

---

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full per-release notes.

### v9.7 — Dashboard preview popover + mintag detection

* **Preview popover** on the analytics icon — **Section A**: recent-uploads grid
  with status borders, suspicious-upload labels, and an NSFW blur toggle;
  **Section B**: a colour-coded activity strip across 11 feed types with a
  link-out legend (`&limit=200` + oldest-row `#anchor`).
* **Suspicious-activity detection**: deleted/banned or heavily-downvoted uploads
  and downvoted comments re-typed into a `suspicious` category; clicking the
  legend item opens the exact flagged posts.
* **Mintag / abandoned detection** (v9.7.1): orange label when the uploader
  added ≤10 tags (from `post_versions` `added_tags`), escalating to red when v2
  lands ≥15 min after v1. A `?` legend explains every label/border colour.
* **Created-tags sort headers**: per-column ▲/▼ sort arrows replace the
  segmented control.
* Mobile/touch tier: mini-report button, unified loading, two-step-tap legends,
  dark-theme-aware popover.

### v9.6 — Counts refresh + sub-chart mode + widget gating

* **Tag Cloud signature filter**: General tab now drops global high-volume tags unless the user uses them above the global rate (Lift filter), so each user's cloud is genuinely characteristic.
* **Sub-chart mode + sub-tag breakdown tooltip** on Copy / Fav_Copy / Char pie legends.
* **Live loading progress** with phase counter + rotating substatus.
* **Configurable count cache TTL** (default 10 min) — 11 distributions + Created Tags refresh automatically.
* **Widget gating**: Tag Cloud (≥100 uploads) and Scatter Plot (≥300 uploads).
* **Status:active filter** on Random / Recent Popular / Top Posts widgets.
* **Adaptive scatter grid density**.
* `RateLimitedFetch`: 6 → 9 req/sec, 6 → 8 concurrent.
* Major internal cleanup — see [docs/audit-remediation.md](docs/audit-remediation.md) for the 6-phase Phase 1-6 audit retrospective.

### v9.5 — UX polish

* Threshold auto-tune preview modal with per-row percentile source.
* Notes cell now navigates to `/note_versions` (was `/posts?...noteupdater:USER`, which excluded most days).
* Approval year selector now correctly handles users promoted past Approver.
* Mobile grass legend tap targets enlarged.

### v9.4 — Reliability

* IndexedDB quota-safe writes with LRU eviction.
* Persistent storage opt-in after first sync.

### v9.0 — Tag Cloud + Created Tags + Scatter rewrite

* New widgets: Tag Cloud (d3-cloud), Created Tags discovery.
* Pie chart expanded to 11 tabs including NSFW-gated categories.
* Scatter plot Score / Tag Count modes with drag selection and hover preview.
* 12 themes × 4 grass palettes each.

### v7.0 — TypeScript Migration

* ~12,000 lines migrated to TypeScript across 13+ modules.
* Build system: Vite + vite-plugin-monkey, `tsc` type checking.
* Vitest unit-test suite introduced.

### v6.x — Tag Analytics & Architecture Overhaul

* TagAnalyticsApp introduced (full analytics for Artist / Copyright / Character tags).
* 3-pane animated summary card with streak duration.
* Token bucket rate limiting (originally 6 req/s).
* GrassApp resizable/movable layout with per-user IndexedDB storage.

### v5.x — Advanced Analytics

* Hourly activity heatmap.
* Approvals module with exact post-ID tracking.

### v4.x — Analytics Dashboard

* Renamed from *Danbooru Grass* to *Danbooru Insights*.
* Tag Distribution, Milestones, Top Posts, Scatter Plot.

### v3.x — Themes & Settings

* Theme customization, contribution thresholds, parallel batch fetching.

### v2.0 — Core Implementation

* Built with `d3.v7` + `cal-heatmap` + `Dexie.js`.

---

## Development

```bash
# clone
git clone https://github.com/AkaringoP/Danbooru-Insights.git
cd Danbooru-Insights
npm install                    # also wires the pre-commit hook automatically

# develop
npm run dev                    # Vite dev server with HMR
npm run test                   # Vitest unit tests (759 cases)
npm run test:e2e               # Playwright e2e (visual baselines)
npm run lint                   # GTS lint
npm run fix                    # auto-fix lint
npm run check:dead             # knip dead-code detection

# build
npm run build                  # vitest run && tsc && vite build → dist/danbooruinsights.user.js
```

The pre-commit hook chains `build → lint → check:dead` and short-circuits when only docs change.

See [CLAUDE.md](CLAUDE.md) for the contributor guide (architecture, layer rules, helper conventions, evaluator rubric).

---

## Credits

- **Author**: [AkaringoP](https://danbooru.donmai.us/users/701499)
- **Co-Author**: Claude Code with VS Code (AI)

## License

MIT — see [LICENSE](LICENSE).
