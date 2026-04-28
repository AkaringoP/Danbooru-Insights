# Changelog

All notable changes to Danbooru Insights are documented here.

---

## v9.4.2 — Mobile UX polish

Four mobile-only UX hotfixes consolidated from `develop`. No schema changes,
no behavior changes on desktop. Touches the User Analytics dashboard's pie
chart, tag cloud, and scatter widgets, plus the Grass settings flyout and
container layout.

### UX (mobile)
- **Grass settings flyout** (`hotfix/settings-popover-fixes`): anchor the
  flyout under the selected theme button on mobile and dismiss on color pick,
  so the picker lands where the user is looking and doesn't linger after the
  choice is made.
- **Grass container overflow** (`hotfix/grass-mobile-overflow`): force
  `box-sizing: border-box` and `min-width: 0` on the Grass containers in the
  mobile media query, eliminating the thin horizontal scroll that appeared on
  narrow viewports because inline desktop sizing wasn't being overridden.
- **Pie chart polish** (`hotfix/pie-mobile-ux-polish`): drop the white
  drop-shadow filter on touched slices (laggy on mobile, kept for desktop
  hover); add a smooth fade-blur transition between pie tabs (0.35s Material
  curve, 380ms minimum visible duration); exclude the legend from the blur
  via a `:not()` selector so the text stays crisp during transitions.
- **Tag cloud + scatter** (`hotfix/tagcloud-tooltip-scatter-yearlabel`): on
  the tag cloud, the tooltip itself is now the navigation target on mobile —
  same-tag re-tap toggles the tooltip closed instead of navigating, matching
  the pie chart's UX. On the scatter X-axis, year labels fall back to
  two-digit form (`09`, `14`, `25`) when year-per-pixel density is too high
  to fit four-digit labels (≤32px/year), eliminating label collision for
  long activity spans.

---

## v9.4.1 — Test infrastructure fix (no user-visible change)

Hotfix released the same day as v9.4.0. Production bundle is byte-identical
to v9.4.0 — `dist/danbooruinsights.user.js` rebuilds with the same source
under the same flags. Bumped solely to keep version numbers aligned with
the merge commit on `main`.

### Internal
- **`vitest.config.ts`**: hardcode `__PERF_ENABLED__` and `__DEBUG_ENABLED__` to `true` instead of reading them from the build-flag branch fallback. The previous setup short-circuited `perfLogger.setEnabled` and `logger.debug` on `main`, causing the seven new perf-logger ring-buffer / p95 tests to silently no-op there. Tests now exercise the actual code paths regardless of which branch the developer is on; build-time gating remains the release-bundle optimization (verified by bundle inspection, not vitest).

---

## v9.4.0 — Tag Analytics Performance + DB Reliability & Observability

Two converging tracks land in this release: a **performance refactor of
the Tag Analytics pipeline** (29 % faster first-sync on large tags) and
a **DB-strategy reliability + observability upgrade** that closes the
remaining gaps from the v10 DB-strategy audit. Schema bumps to v12 to
support the new tag-analytics caches; the two existing tables added in
v12 are the only schema delta of the release.

### Tag Analytics — first-sync time -29 % on large tags

Headline benchmarks (cold IDB, dev build):

| Target | v9.3.x main | v9.4.0 | Δ |
|---|---|---|---|
| `umamusume` (198 k posts) full analysis | 84.7 s | 60.3 s | **-29 %** |
| `gakuen_idolmaster` (22 k posts) full analysis | 28.6 s | 23.4 s | **-18 %** |
| Backward history scan (rename target) | ~16 s | 6.98 s | **-56 %** |

Pipeline structure:
- **Phase 1 (Quick Stats) and Phase 2 (Rankings & History) now run concurrently** instead of strictly sequentially. Phase 3 (Rating Counts) stays serial because it depends on `historyData.minDate`.
- The earlier "progressive partial paint" experiment was reverted in favor of an **atomic dashboard render** — every widget paints once, after all data is ready. This kept the UI flow steady and made the savings below safe to take (no widget would surprise the user by re-laying-out mid-paint).

Persistent caches (DB schema v12):
- **`tag_monthly_counts`** — per-tag, per-month post count cache with **distance-based TTL** (the older the month, the longer the TTL — recent months stay short, ancient months effectively immutable, capped at 90 days). Wipes the cache on user-triggered cache reset; refuses to auto-resync after a reset (the reset itself is the user's signal that they wanted fresh state).
- **`tag_implications_cache`** — global 180-day cache for `isTopLevelTag` results. Implications are de-facto immutable per Danbooru's editorial workflow, so a long TTL is safe.

Network-shape changes:
- **Batched `tag_implications` lookup** via `search[antecedent_name_comma]=t1,t2,…&limit=1000` collapses up to 20 individual API calls into a single request. Implementation lives in `TagAnalyticsDataService.fetchTopLevelTagsBatch`.
- **Frequency-approximated distribution** with SWR swap-in: the related-tag pie chart paints immediately from the `frequency` field in `/related_tag.json`, then the exact `/counts/posts.json` per-tag values stream in and the chart re-renders silently. First paint is no longer blocked on N count queries.
- **Stale-while-revalidate ranking reports** on revisit: the Ranking widget paints from cache instantly and only re-fetches the report set in the background, swapping in if anything changed. Removes the visible 2 – 4 s wait on cache-warm reloads.

Backward-scan fixes (the rename-target path that walks history backwards
to find the original tag's posts):
- Duration is now isolated as a perf-logger span (`bw.*` family) so future
  regressions surface in p95 dashboards.
- Override-block and first-100 resolution are deduped — a single
  `fetchTagData` round-trip drives both, and `resolveFirst100Names` no
  longer re-fires when the backward scan already produced names.
- Service-instance memoization on `fetchTagData` removes duplicate
  network calls within a session.

UX touches that came along for the ride:
- Diagnostic panel now starts hidden; a small "DI" reopen button replaces
  the always-on overlay.
- Cache reset now also clears the monthly cache and immediately resets the
  status label, so the next analysis starts visibly cold.

### Reliability (P1) — Quota-aware bulkPut + persistence opt-in

- **`bulkPutSafe()`** (`src/core/quota-manager.ts`): quota-aware wrapper around Dexie bulk writes. On `QuotaExceededError` — including the common `AbortError` Dexie wraps it in — runs an evictor closure and retries the write once; second failure rethrows so callers surface the failure rather than loop. Wraps 5 of the 8 `bulkPut` call sites in `analytics-data-manager.ts` and `tag-analytics-data.ts`. The 3 sites inside `db.transaction(...)` callbacks keep the raw `bulkPut` to avoid `PrematureCommitError`.
- **LRU eviction with current-user guard**: `evictOldestNonCurrentUser()` ranks users by their `danbooru_grass_last_sync_<uid>` localStorage timestamp and deletes the oldest non-current user's `posts` + `piestats`. The active profile's data is **never** touched, so analytics correctness is preserved even at quota pressure (enforced by unit test).
- **Pre-emptive sampling**: 25 % of `bulkPutSafe` calls poll `navigator.storage.estimate()`; if usage / quota > 0.8, the evictor runs ahead of the write to avoid the throw entirely. No background loop — sampling is enough without leader election.
- **Persistent storage request**: `requestPersistence()` is invoked once at the end of the first successful Quick / Full sync, idempotent via the `di.persist.requested` localStorage flag. Mitigates Safari ITP 7-day eviction and Chrome's heuristic eviction for engaged users.
- **`AbortError` unwrapping**: `unwrapAbortError()` exposes both the outer name and `.inner.name`, so quota errors hidden inside Dexie's wrapping always show up in `logger.error` payloads instead of being silent.

### Reliability (P2) — Multi-tab `versionchange` / `blocked` handlers

- `Database` now subscribes to Dexie's `versionchange` and `blocked` events. On `versionchange`, the old tab calls `db.close()` + `window.location.reload()` so the upgrading tab in another window can proceed instead of deadlocking. On `blocked`, a structured warning is logged.
- Eliminates the `Upgrade 'DanbooruGrassDB' blocked by other connection holding version 0.1` and `Dexie: Need to reopen db` console errors that appeared in multi-tab measurements: 4 such events on the v9.3.x baseline (3 concurrent tabs) → **0 events** on v9.4.0.
- No `confirm()` prompt before reload — DanbooruInsights is a read-only widget, and a confirm-cancel would only preserve the deadlock without giving the user any meaningful work to save.

### Observability (P5) — `performance.mark` / `measure` + p95 stats + `dbi:` prefix

- **User Timing API integration**: `perfLogger.mark()` / `measure()` now drive `performance.mark` + `performance.measure`, so spans appear natively in the Chrome DevTools **Performance** panel under "User Timing". Legacy `start()` / `end()` are aliases backed by the same internals — call sites can mix and match.
- **p95 / p99 stats buffer**: each label keeps a 100-sample FIFO ring buffer. `perfLogger.stats(label)` returns `{p50, p95, p99, count}` (nearest-rank), and `perfLogger.dumpStats()` prints a p95-ranked table when `localStorage['di.perf.stats']='1'` is set. Both are dead-code-eliminated on `main` builds, so leaving the calls in code costs nothing.
- **Unified `dbi:` label namespace**: 59 perf labels rewritten across `analytics-data-manager.ts`, `user-analytics-app.ts`, and `user-analytics-data.ts` to `dbi:<channel>:<op>:<phase>` (e.g. `sync.full.page.w0` → `dbi:db:sync:full:page.w0`, `render.fetchData.summaryStats` → `dbi:net:fetchData:summaryStats`). Makes labels grep-friendly and clearly distinguishable from browser-built-in performance entries.

### Internal

- **Schema migration**: Dexie v11 → v12 with two new tables (`tag_monthly_counts`, `tag_implications_cache`); existing tables and indexes unchanged.
- **Bench A/B tooling**: `scripts/bench-collect.ts` parses both `[Perf #N]` (perf-logger) and the legacy `[DI:…] DEBUG [Task] / [Phase] / [PerfProbe]` (tag-analytics debug) families; `scripts/bench-compare.ts` normalizes labels through a v9.3 → v9.4 alias table and emits a Markdown diff with ±5 % regression flagging. The `bench/` workspace (saved baseline / feature userscripts, captured logs, generated reports) is gitignored.
- **Build variant detection** centralized via branch-fallback in `build-flags.ts` — `DI_PERF` / `DI_DEBUG` / `DI_BUILD_VARIANT` env overrides keep working for Phase 0 / Phase 4 measurements without code changes.
- **Test coverage**: +34 tests / +3 files vs the v9.3.1 baseline. Quota recovery (21), perf-logger ring buffer + p95 (10), and `versionchange` handler (3) are the new files. Total 264 / 19.
- **ESLint**: `@typescript-eslint` override scope tightened so it only applies where the plugin is actually loaded, and the local build-comparison artifact is now in the ignore list.

### Forensic note on the wall-clock comparison

Phase 4 ran a side-by-side A / B between the v9.3.x main build and the
v9.4.0 feature build using the new `bench/` tooling. The headline
result is the P2 deadlock removal (4 events → 0). Many wall-clock
metrics, however, regressed +50 % to +1860 % — including a single
`/counts/posts.json` request jumping from 305 ms to 5996 ms, which is
implausible from a µs-scale wrapper. The pattern is consistent across
network-bound spans and absent on network-independent ones (e.g.
`dbi:db:sync:full:bulkPut.w*` showed +0.8 % to +7.5 %, exactly the
expected `bulkPutSafe` overhead). The most likely cause is Danbooru
API server-side latency variance at measurement time, not a code
change. Full interpretation in `bench/reports/phase4-summary.md`
(local).

---

## v9.3.1 — Fix Missing Today's Uploads Across Timezones

### Bug Fix
- **Today's uploads silently missing from the contribution graph**: The delta fetch upper bound was computed as `today + 1 day` in UTC, but Danbooru's `date:A...B` filter is upper-bound-exclusive AND evaluated in the user's configured timezone. For users whose Danbooru TZ is ahead of UTC (e.g. KST = UTC+9), the cutoff landed on the very day they were uploading — those posts were filtered out by the server and never cached, even though they showed up in a direct Danbooru search. Fix: expand the delta fetch window to a symmetric ±3 days around today, absorbing any browser↔Danbooru timezone offset and any future-dated posts (backend queueing, clock skew, rating review).

### Internal
- **Per-branch dev builds via CI**: Pushes to `claude/**`, `fix/**`, `feature/**` branches now auto-publish a `(dev)` variant of the userscript to the `testbuild` branch, installable separately from prod in Tampermonkey for iterative real-environment testing.
- **Diagnostic panel no longer races initial sync**: Previously, `#di_diag` opened in parallel with GrassApp's first sync, so its DB reads could reflect a stale pre-sync snapshot (showing `Today: not cached` / `MISMATCH` even when the grass calendar itself rendered correctly). GrassApp now dispatches a `di:sync-complete` event after the final render, and `main.ts` defers `showDiagnostic()` until that event fires, with a 6 s timeout fallback for tag pages and unusually slow syncs.

---

## v9.3.0 — Magnet Snap, Structured Logging, Mobile Fixes & Test Coverage

### GrassApp Magnet Snap-to-Edge Resize
- **Magnet snap effect**: When resizing the grass container, width snaps to the current-month-to-December edge with a ±15 px hysteresis band. Togglable via "Snap to edge when resizing" checkbox in the settings popover.

### Structured Logging & Observability
- **Structured logger**: Replaced all 123 raw `console.*` calls with a dual-gated structured logger (build-time dead-code elimination + runtime `localStorage` opt-in). Supports `debug`, `info`, `warn`, `error` levels with per-module namespaces.
- **Toast notifications**: Replaced 6 `alert()` calls with non-blocking, auto-dismissing toast notifications for a smoother UX.
- **Mobile diagnostic overlay**: All three apps (GrassApp, UserAnalyticsApp, TagAnalyticsApp) gain a floating diagnostic overlay on mobile for debugging sync status and cache state.
- **v9.2.4 cache revalidation**: One-time migration that compares current-year local row sums against remote counts (uploads + approvals) and clears stale data left by the pre-v9.2.3 page-skip bug. Idempotent — stores a per-user flag in `localStorage` and skips on subsequent loads; retries automatically if the network check fails.

### Mobile Fixes
- **Stats max-width reset**: The inline `maxWidth: 60%` (for GrassApp inline layout) was clipping profile stats on mobile. Reset via media query so stats reclaims full width on narrow viewports.
- **Scatter downvote filter layout**: Converted `.di-scatter-downvote` to static positioning on mobile so it flows below the rating filter row instead of overlapping the chart.
- **Milestones 2-column grid**: UserAnalytics milestones forced to a 2-column grid on mobile with compact padding and thumbnail sizing.
- **Grass tooltip tap-only trigger**: Replaced `touchstart`+`touchmove` tooltip handlers with tap detection (≤10 px movement threshold). Drag gestures now only scroll — no accidental tooltip activations.

### Author Profile Link
- **Dashboard footer**: AkaringoP author label in the dashboard footer now links to the Danbooru profile page.

### Internal
- **DataManager data integrity tests**: 30 new test cases covering remote/local count comparison, safe deletion boundaries, year completion cache, 3-day safety buffer, user ID validation, hourly stats delta merge, `revalidateCurrentYearCache`, `clearCache`, `fetchRemoteCount`, and `fetchAllPages` pagination. Previously 0% test coverage for these critical data paths.
- **185 tests pass** across 13 test files (up from 155).

---

## v9.2.3 — Fix Delta Fetch Page Skip

### Bug Fix
- **Fix pages skipped during adaptive batch scale-up**: When delta fetch scaled batch size from 1 to 3 after a full first page, `page += batchSize` used the *new* batch size (3) instead of the *fetched* batch size (1), skipping pages 2–3 entirely. This caused partial data overwrites — e.g. a day with 1030 approvals could be written as 509. Fixed by tracking the actual fetched batch size separately.

---

## v9.2.2 — Increase Page Limit for Approvals & Notes

### Improvement
- **Approvals and Notes now fetch 1000 items per page** (up from 200). The Danbooru API allows up to 1000 for all endpoints except `/posts.json` (capped at 200). Combined with the adaptive batch size from v9.2.1, this reduces approvals/notes sync to ~1/25th of the original request count.

---

## v9.2.1 — Adaptive Batch Size for Approvals

### Bug Fix
- **Approvals full fetch no longer throttled to batch size 1**: Approvals previously forced `BATCH_SIZE=1` regardless of context, making large fetches (e.g. 29,000+ items) ~5× slower than necessary. Now uses the same parallel batching (size 5) as uploads and notes.

### Improvement
- **Adaptive batch size for delta fetches**: Delta fetches start with batch size 1 (optimal for the common case of ≤200 items in the 3-day safety buffer). If the first page returns full (200 items), batch size scales up to 5 for the remaining pages.

---

## v9.2.0 — GrassApp Vertical Drag, Performance & Theme Refresh

### GrassApp Vertical Drag-to-Below
- **Inline ↔ Below layout switching**: Drag the move handle vertically (30px+ threshold) to toggle GrassApp between stats-beside (inline) and stats-below (below) mode. Hysteresis (30px activate / 10px deactivate) prevents accidental switches.
- **Per-mode width & offset persistence**: Each layout mode independently remembers its width and horizontal offset — switching modes restores the previously set dimensions instead of resetting.
- **Destination-bar visual hint**: A glowing pulse bar appears at the container edge in the drag direction with a directional label ("Move to below ↓" / "Move to side ↑").
- **Natural width ceiling**: Container width is capped at the CalHeatmap 12-month intrinsic span (measured via `.ch-domain` SVG bounding rects, cached after paint with rAF deferral). Resize handles and initial layout both respect this cap — no empty space beyond December.
- **Resize-time scroll anchoring**: During resize drag, `scrollToCurrentMonth()` runs every frame so the current month stays in view as the container narrows.
- **Long Previous Names support**: Stats section gains `max-width: 60%` + `overflow-wrap: break-word` so users with many previous names still get GrassApp beside stats.
- **Visual mode detection**: Naturally-wrapped users (viewport too narrow for inline) are correctly detected via `offsetTop` fallback even without a saved `layoutMode`.

### GrassApp Width & Handle Improvements
- **Natural width fit**: Container auto-sizes to CalHeatmap's 12-month width instead of stretching to fill the row. Eliminates the "empty space right of December" problem.
- **Hourly panel as drag floor**: Minimum width clamped to the Hourly Distribution panel's rendered width instead of a hardcoded 300px.
- **Resize handle visibility**: Left/right resize handles now have a faint background (`rgba(136,136,136,0.08)`) with hover darkening and rounded inside corners for discoverability.

### Dashboard Render Performance
- **Stale-While-Revalidate (SWR) caching**: 4 cached `fetchData` children (Milestones, TopPosts, RecentPopular, LevelChange) return stale piestats instantly and revalidate in the background. Revalidation thunks are deferred via `setTimeout(0)` until after `render.total` completes to avoid rate-limiter contention.
- **Random posts off critical path**: `getRandomPosts` moved from the blocking `Promise.all` to a post-render microtask.
- **Status/Rating SWR**: Distribution stats also use the SWR pattern with deferred revalidation.
- **Auto-sync race fix**: `isFullySynced` initialization awaited before the sync button handler reads it, preventing spurious partial syncs on fast page loads.

### Theme Changes
- **Dracula replaces Newspaper**: Newspaper (`bg: #f0f0f0`) was a light theme misplaced in the dark section. Replaced with Dracula (`bg: #282a36`) with Green, Pink, Purple, and Cyan grass options. Existing Newspaper users auto-fallback to Light.
- **Theme preview link**: "Preview all" link next to "Color Themes" in the settings popover opens the GitHub Pages-hosted preview page with all 12 themes and 48 grass palettes.
- **Performance instrumentation**: Build-gated `PerfLogger` with two-stage gating (build-time dead-code elimination on main + runtime localStorage opt-in). 20+ labeled measurement points across sync and render paths.

### Internal
- `GrassSettings` extended with `inlineWidth`, `inlineXOffset`, `belowWidth`, `belowXOffset`, `layoutMode` fields (Dexie schemaless — no version bump).
- `scrollToCurrentMonth()` extracted as a `GraphRenderer` class method for reuse across paint, mode-switch, and resize contexts.
- `measureNaturalWidth()` uses `.ch-domain` `getBoundingClientRect` with labels/padding accounting, cached with rAF-deferred invalidation.
- `theme-preview.html` added as a GitHub Pages-hosted visual reference for all themes.

---

## v9.1.0 — Dark Mode, Code Quality Overhaul & Perf Fix

### Dashboard Dark Mode (UserAnalyticsApp, TagAnalyticsApp)
- **Auto / Light / Dark selector** in each app's ⚙️ settings popover. Default `auto` follows Danbooru's `data-current-user-theme` attribute; manual choices override and persist in localStorage.
- **Scoped to dashboard containers**: dark overrides apply to our modals and popovers only (`[data-di-theme="dark"]`), never to `body` or `:root`. This avoided the full-page style recalculation that would otherwise hit Danbooru's large DOM.
- **Semantic CSS variable system** (`--di-bg`, `--di-text`, `--di-border`, …) with light values as `var()` fallbacks — light mode is zero-cost (no variables defined). ~410 color references migrated across 11 files.
- **Runtime palette helper** (`src/ui/theme-palette.ts`) for canvas contexts where CSS variables can't be used directly. Scatter plot reads computed styles from its nearest themed ancestor so grid / axis / labels flip with the dashboard.
- **Cross-tab sync** via the `storage` event: changing the theme in one tab reapplies it in any other tab that already has a dashboard open.
- **GrassApp scope carve-outs**:
  - Contribution graph chrome (year selector, ⚙️/∨ buttons, panel border, legend, retry) stays fixed in light colors — its existing 12-theme palette system is independent of the dashboard dark mode.
  - GrassApp settings popover follows the *selected grass theme* (top 6 themes → light popover, bottom 6 → dark) via `applyPopoverPalette` — no Danbooru theme detection, so no overhead on open.
  - Approvals popover uses the same palette helper.
- **Semantic point color** for the scatter plot `gentags < 10` highlight: `#000` → ruby red `#e0115f`, visible on both themes (slightly larger dots).

### GrassApp Delta-Fetch Performance (hotfix)
- **Reload with cached data: ~2,100 ms → ~300 ms.** Two fixes in `DataManager.getMetricData`:
  1. **Batch size 1 for delta fetches.** `fetchAllPages` fired 5 `/posts.json` pages in parallel even when the delta range held <200 items, wasting 4 empty-page requests (~1.5 s). Added an `isDelta` parameter; set when `lastEntry` exists and no force-full-fetch is requested. Initial full loads still use 5 for parallelism.
  2. **Narrow `endDate` for current-year delta fetches.** The range ran from `lastEntry − 3 days` to *Jan 1 of next year*, forcing the API to scan months of empty range. Now clamped to tomorrow when cached data exists for the current year.
- Past-year paths unchanged — once `markYearComplete` caches a year, the API call is skipped entirely on subsequent opens.

### Code Quality Initiative (no user-facing changes)
#### Lint as a hard CI gate
- ESLint v9 flat config (`eslint.config.js`) vendor-bypasses the broken `gts@7.0.0` path under ESLint v9. Prettier brought in for formatting. `.github/workflows/build.yml` lint step is now a hard gate (no `continue-on-error`).
- Full strict posture: **5,037 → 0** lint errors with **no rule relaxations**.
  - 285 `no-explicit-any` → replaced with real types (Danbooru API response interfaces in `src/types.ts` covering `/posts.json`, `/post_approvals.json`, `/note_versions.json`, `/counts/posts.json`, `/related_tag.json`, `/users.json`, `/tags.json`, `/reports/posts.json`, …). Two documented escape hatches: `D3Any` and `CalHeatmapAny` (single disable on alias definition — libraries lack type packages).
  - 42 `no-floating-promises` → case-by-case fixes. Several latent missing `await`s on `saveToCache` discovered and fixed; others marked `void` with intent comments; one detached chain gained `.catch()` so fetch failures log instead of disappearing silently.
  - Plus miscellaneous cleanup: `== null` → `=== undefined`, empty-catch drops, dead-code removal, `function`-expression d3 callbacks to arrow functions.
- Tests included — no `warn` escape valve.

#### Structural refactors
- **Inline `style="..."` → `GLOBAL_CSS`**: `tag-analytics-app.ts` template literals migrated to ~350 new lines of `di-` prefixed CSS (`buildMainGrid`, `buildDashboardHeader`, `buildRankingsSection`, `buildBottomSections`, `showSettingsPopover`, `createButton`, `createModal`). One intentional dynamic survivor: the category-driven `<h2 style="color: ${titleColor};">`. Fixed a `.di-nsfw-monitor` base rule that would have crushed milestone-card layout (added the same `:not(.di-milestone-card)` carve-out the mobile override already used).
- **`TagAnalyticsApp._fetchAndRender()` split**: 878-line method → 67-line orchestrator + 6 private helpers (`_checkCache`, `_fetchSmallTag`, `_calculateLocalTagDistribution`, `_fetchLargeTag`, `_runQuickStatsPhase`, `_buildHeavyStatPromises`). Cache-first / delta-sync / small-tag-optimization semantics preserved.
- **Scatter plot decomposition**: `renderScatterPlot()` 1,252-line closure → 50-line orchestrator calling 22 top-level helpers. All 11 closure-captured variables moved into a `ScatterState` interface; 17 DOM references into `ScatterDom`. Pure helpers (`computeScatterScale`, `filterVisiblePoints`, `createInitialScatterState`) now testable without DOM mocking.
- **Shared two-step tap utility** (`src/ui/two-step-tap.ts`): consolidated the touch-then-tap pattern used by the tag cloud, pie chart, and CalHeatmap. Exports a generic `createTwoStepTap<T>({onFirstTap, onSecondTap, onReset, …})` factory and a single `isTouchDevice()` detector — replaces 5 inline duplicates across widgets.

#### Backfill error recovery (user-facing for heavy uploaders)
- Scatter plot `down_score` backfill no longer retries indefinitely on failure. Tracks `{lastAttemptAt, failureCount}` per user in `localStorage`; skips if `failureCount ≥ 3` within a 24h cooldown. HTTP 429 is *not* counted (rate-limiter already backs off). 17 unit tests cover the threshold / cooldown / HTTP-status logic.

### Minor features & fixes
- **Created Tags sort control**: The Created Tags widget gains a segmented control to sort by creation date (default) or alias post count, with alias-aware tag links opening the consequent tag's search page.
- **Scatter plot mobile layout fix**: Downvote filter bar moved below the rating buttons to avoid overlap on narrow viewports.

### Internal
- **42 files changed** across the quality initiative, +7,706 / −3,489 lines.
- **153 tests pass**, architecture fitness tests enforced (dependency direction `core/ → ui/ → apps/`, no `[key: string]: any`, no raw `fetch()`).
- **Build**: 526 kB → 544 kB (+18 kB: mostly CSS variables, shared utilities, and type boundaries).

---

## v9.0.1 — Repository Migration

No functional changes. The project now lives in its own repository at
[AkaringoP/Danbooru-Insights](https://github.com/AkaringoP/Danbooru-Insights),
split out of the original [AkaringoP/JavaScripts](https://github.com/AkaringoP/JavaScripts)
monorepo with its full git history preserved via `git subtree split`.

- `@updateURL` / `@downloadURL` point at the new repository's `build`
  branch. Existing installations will receive this patch once through
  the old URL and then self-migrate to the new update endpoint on the
  next check.
- `homepageURL` and the dashboard footer link now point at the new
  repository.
- README install link updated.

---

## v9.0.0 — Mobile Support, Scatter Plot Overhaul & Schema Migration

### Mobile Compatibility
- **Fullscreen Modal**: UserAnalyticsApp and TagAnalyticsApp dashboards now fill the viewport on mobile (`100dvh` so the URL bar no longer leaks the page beneath).
- **Responsive Layout**: Pie chart + legend stack vertically; summary cards collapse to one column; top posts, trending thumbnails, scatter plot toggle/filter, and tag analytics header all reflow under 768 px. TagAnalytics rankings switch to a horizontal scroll-snap swipe.
- **Touch Interactions** (2-step pattern: tap → tooltip → action):
  - **CalHeatmap cells**: tap or drag shows tooltip with date + count, tooltip tap navigates to `/posts`.
  - **D3 pie chart**: same 2-step pattern, slice enlarges on touch with viewport-clamped tooltip.
  - **Tag cloud**: 1st tap highlights word + shows tooltip, 2nd tap navigates. Desktop hover suppressed on touch. Invisible stroke widens hit area.
  - **Scatter plot**: drag selection disabled on touch; year tap zoom retained.
  - **Monthly bar chart**: milestone stars no longer navigate (tap-through to bar's month query).
- **Modal Close Behaviors**: Browser back button closes the modal via `history.pushState/popstate` (both apps); X button and Escape route through `history.back()` for state sync. UserAnalyticsApp gains Escape key support (was TagAnalytics-only). TagAnalytics modal restructured so the X button stays sticky during scroll.
- **Milestone cards** in TagAnalytics rebuilt with absolute thumbnail positioning to avoid flex `min-content` overflow on narrow viewports.
- **Tag cloud font size** and SVG `overflow: hidden` tuned for narrow viewports.

### Scatter Plot Enhancements
- **Tag Count mode Y=10 click**: The "10" tick is rendered red bold and is clickable. Clicking it shows a tooltip with two counts (`gentags:<10` / `tagcount:<10`) and deep links to the corresponding `/posts` queries. Points with t < 10 are highlighted in black on hover/active.
- **Score mode downvote filter**: Four mutually-exclusive toggle buttons (`>0`, `>2`, `>5`, `>10`) above the chart. The filter applies to both the rendered points and the drag-selection popover so the count and list always agree.
- **Post hover preview card**: Hovering a post in the scatter popover or the GrassApp approval popover now shows a small floating card with thumbnail, score, fav count, rating, and first artist/copyright/character tag. 100 ms debounce + in-memory cache. Disabled on touch devices.
- **Drag selection persistence**: The selection rectangle stays visible while the popover is open (used to vanish immediately on mouseup) and is hidden on any re-render or popover close.
- **Deleted/banned posts in popover list**: shown as gray dots with a "Deleted" / "Banned" tooltip.
- **Effort scatter mode removed**: The previous attempt at correlating tag effort with score did not surface meaningful insight and was rolled back.

### Milestones
- **Next Milestone Card**: Both UserAnalyticsApp and TagAnalyticsApp now show an extra "next milestone" placeholder card at the end of the milestones grid, with the upcoming milestone label, "X remaining", and a progress bar measured against the previous milestone. Respects the active step selector mode in UserAnalyticsApp.

### Database Schema (v9 → v10)
- **New `user_stats` table**: caches `gentags_lt_10` and `tagcount_lt_10` counts per user with a 24 h expiry, used by the scatter plot Y=10 click feature.
- **`posts` table** gains four new fields: `up_score`, `down_score`, `is_deleted`, `is_banned`. Sync requests now use `only=...,up_score,down_score,is_deleted,is_banned,...` and `score` is stored as `up_score + down_score`.
- **Silent backfill** runs the next time the dashboard opens for any user with cached posts that predate these fields. It uses cursor pagination over `id:>X order:id status:any` so deleted/banned posts are included, fetches only the new fields, and merges them into existing records. Disables the downvote filter buttons with a "updating XX%" indicator until complete.

### GrassApp
- **Width restoration fix**: Long-standing issue where the saved grass width / xOffset was clobbered on every dashboard open. The `renderGraph()` column wrapper used to force `mainContainer.style.width = '100%'` after `applyConstraints()` had already set the px value. Removing those two lines lets `applyConstraints` win, and a `ResizeObserver` re-applies once the wrapper has finished its initial layout pass so a 0-width first frame can no longer clamp the saved width down to 300 px.

### Internal
- **Centralized version constant**: New `src/version.ts` exports `APP_VERSION`, `APP_REPO_URL`, `APP_AUTHOR`. `vite.config.ts` imports the version instead of hardcoding it, so future bumps only touch one file.
- **Dashboard credit footer**: Both apps append a small centered credit line at the bottom of the dashboard with the version (linking to the GitHub repo) and author. Shared via `src/ui/dashboard-footer.ts`.
- **Per-theme grass palette memory**: Grass palette selection is now remembered per theme instead of resetting to default on theme switch. Uses a `grassIndexByTheme` map with legacy `grassIndex` migration.

---

## v8.1.0 — Cross-Tab Rate Coordination

- **TabCoordinator**: Uses `BroadcastChannel` to track active tabs and divides the rate budget (RPS, concurrency) equally among them, preventing 429 errors when the user has multiple Danbooru tabs open.
- **Global 429 Backoff**: On a 429 response, all requests pause for 5 s and the backoff is broadcast to other tabs via TabCoordinator.
- **Single shared RateLimitedFetch** per tab instead of independent instances per app class.
- **Dynamic rate reconfiguration**: `RateLimitedFetch.updateLimits()` for runtime changes and `setBackoff()` for cross-tab backoff propagation.

Closes #5.

---

## v8.0.5 — Skip Error Pages

- **Hotfix**: Detect non-Danbooru pages (nginx 429 / 502) by checking `document.body.classList`. Error pages have a bare `<body>` with no classes, which previously caused `ProfileContext` to misparse the error title as a username.
- `injectGlobalStyles()` is now called after the guard so CSS is not injected on error pages.

---

## v8.0.4 — User History Timeline Discoverability

- **Slim always-visible scrollbar** (8 px) on the User History timeline via `::-webkit-scrollbar` and `scrollbar-width: thin`. Works on Chrome/Firefox where a custom scrollbar style disables overlay auto-hide. Hovering darkens the thumb.
- **Bottom fade gradient** as a fallback for Safari/macOS where overlay scrollbars auto-hide regardless of custom styles. Only shown when the `has-overflow` class is set via JS after measuring `scrollHeight`.

---

## v8.0.3 — Member(Blue) 2-Tag Query Limit Compatibility

- **Fix**: Gender and Translation Untagged count queries used 4–6 tags, exceeding the Member(Blue) 2-tag search limit and failing silently on those accounts.
- Decompose Gender into parallel single-tag fetches (summed) and compute Translation Untagged via inclusion-exclusion over 6 subqueries (all ≤ 2 tags).
- Click navigation URLs are kept aligned with the conceptual count query via `DistributionItem.originalTag`, so Gold+ users see unchanged behavior while Member users get consistent error pages on over-limit categories instead of missing data.

---

## v8.0.2 — Commentary/Translation Pie Chart Click Fix

- **Fix**: Commentary and Translation pie chart click navigation was using the wrong tag for some categories.

---

## v8.0.1 — Firefox Pie Chart Pointer Events Fix

- **Fix**: Firefox breaks SVG pointer events inside CSS 3D-transformed containers (`perspective + rotateX`), making pie chart hover tooltips and click navigation completely non-functional.
- Detect Firefox via `navigator.userAgent` and skip the 3D perspective, `rotateX`, `preserve-3d`, and shadow layer on Firefox. Use a simple `scale(1.05)` hover instead.
- Chrome/Safari/Edge: unchanged (3D tilt effect preserved).

---

## v8.0.0 — New Widgets, Theme System Overhaul & UX Improvements

### New Widgets
- **Tag Cloud**: d3-cloud word cloud visualizing user's most-used tags across 4 categories (General/Artist/Copyright/Character). Log-scale font sizing, crossfade tab transitions, layout caching. General tags selected by Cosine similarity for user-characteristic results.
- **Created Tags**: Discovers general tags created by the user via NNTBot forum report parsing. Auto-detects previous usernames, shows current status (Active/Aliased/Deprecated/Empty) with alias post counts. Lazy-loaded with progress indicator.

### Pie Chart Enhancements
- **Gender Tab**: Girl/Boy/Other/No Humans distribution via OR queries.
- **Commentary Tab**: Commentary/Requested/Untagged distribution.
- **Translation Tab**: Translated/Requested/Untagged distribution.
- **2-Row Tab Layout**: Top row (Copy, Char, Fav_Copy, Status, Rate, Cmnt, Tran), bottom row (Gender, Boobs, Hair_L, Hair_C).
- **Tab Tooltips**: Hover for full name (e.g., "Copy" → "Copyright").
- **Thumbnail Fix**: `enrichThumbnails()` now awaited — thumbnails fully loaded before dashboard opens.

### Theme System
- **3 New Themes**: Lavender (Light), Monokai (Dark), Ember (Dark gradient). Sunset removed.
- **Grass Color Picker**: 4 selectable grass palettes per theme (48 total). Flyout UI appears on theme icon click. d3-scale-chromatic inspired palettes (Viridis, Inferno, Plasma, etc.).
- **Live Preview**: CalHeatmap destroy+repaint on theme/grass change with scroll position preserved.
- **ThemeChanged Event**: Cross-component reactivity for instant color updates.

### Scatter Plot
- **Drag Range Display**: Shows date range, score/tag count range, and post count during drag selection. Dark tooltip above selection box, debounced (50ms).
- **Crosshair Cursor**: Visual indication of drag capability.

### Milestones
- **Repdigit Option**: Milestones at repdigit numbers (11, 111, 222, ..., 9999, 11111+).
- **Every 10k Option**: For large uploaders.

### Architecture & Quality
- **Architecture Fitness Tests** (5): Dependency direction enforcement, `[key: string]: any` ban, raw `fetch()` ban. Found and fixed 2 existing raw fetch violations.
- **Git Pre-commit Hook**: Auto-runs `npm run build` on DanbooruInsights changes.
- **Rate Limit Fix**: `enrichThumbnails` concurrency reduced from 3 to 2 to prevent 429 errors.
- **Settings Popover**: Moved to `document.body` (position:fixed) for correct z-index stacking. Scroll-anchored to settings button.
- **Hourly Panel Sync**: Follows heatmap container position on resize/move.
- **Bug Fix**: `has:comments` → `has:commentary` in TagAnalytics commentary pie chart.

### Stats
- **112 automated tests** (up from 86)
- **12 themes** with 48 grass color options
- **~15,000 lines of TypeScript**

---

## v7.x — Architecture Refinement & Incremental Features

### v7.5.0
- **Pie Chart**: Added Gender, Commentary, Translation tabs. 2-row tab layout. Title tooltips on hover.
- **Scatter Plot**: Drag range display (date + score/tag count + post count), crosshair cursor.
- **Milestones**: Repdigit (111, 222, ...) and Every 10k options.
- **Bug Fix**: TagAnalytics `has:comments` → `has:commentary`.

### v7.4.0
- **Created Tags Widget**: NNTBot forum report parsing to discover tags created by user.
- Auto-detect previous usernames via `user_name_change_requests` API.
- Optimized alias checking: only post_count=0 tags + parallel (concurrency 5).
- Lazy loading with real-time progress indicator.

### v7.3.0
- **Tag Cloud Widget**: d3-cloud word cloud with 4 category tabs (General/Artist/Copyright/Character).
- Log-scale font sizing, crossfade transitions, layout caching.
- General tags selected by Cosine similarity for user-characteristic results.

### v7.2.2
- **Architecture Separation (Phase 5)**: Split monolithic TagAnalyticsApp and UserAnalyticsApp into data/charts/app modules.
- **Type Safety**: Added core interfaces (TagCloudItem, CreatedTagItem, PostRecord, etc.), removed `[key: string]: any` index signatures.
- **Code Cleanup**: Extracted shared utilities, centralized magic numbers, added debug logging to empty catch blocks.
- **Test Coverage**: 86 tests (up from 55).

### v7.0.0

> Developer release — no user-facing changes. Functionally identical to v6.5.2.

- **TypeScript Rewrite**: Migrated the entire codebase (~12,000 lines) from a single JavaScript file to 13 TypeScript modules with full type annotations.
- **Build System**: Introduced Vite + vite-plugin-monkey for bundling and `tsc` for type checking, replacing the hand-edited single file workflow.
- **Test Suite**: Added 55 automated unit tests (Vitest) covering `config`, `settings`, `rate-limiter`, `utils`, `analytics-data-manager`, and `main`.
- **Module Architecture**: Codebase split into `config`, `styles`, `types`, `utils`, `core/*`, `ui/*`, and `apps/*`.

---

## v6.x — Tag Analytics & Architecture Overhaul

### v6.5.2
- **Fix**: Extracted `isTopLevelTag()` as a shared utility, replacing duplicated inline implication-check logic in `TagAnalyticsApp` and `AnalyticsDataManager`.
- **Fix**: Corrected copyright tag filtering to properly exclude sub-tags via `isTopLevelTag()`.

### v6.5
- **3-Pane Animated Summary Card**: Redesigned the Tag Analytics Summary Card — Profile Info, Key Milestones (progress rings), and D3.js Pie Charts with hover states.
- **Streak Duration**: Summary card now calculates and displays the user's maximum contribution streak.
- **Dynamic Username Colors**: Username in Dashboard Header and Ranking Columns is colored by Danbooru level tier.
- **CSS Architecture**: Consolidated all inline `<style>` strings into a single injected `GLOBAL_CSS` stylesheet. Renamed all internal CSS classes with `.di-` namespace prefix.

### v6.4
- **UI**: Removed Bubble Chart for a cleaner dashboard.
- **Performance**: Optimized thumbnail logic to prioritize WebP format; reduced storage/API overhead.
- **Fix**: Corrected monthly chart date range; added random post refresh button; added link button to Recent Popular post.

### v6.3
- **UI**: Refactored pie chart tabs into pill-shaped buttons.
- **Feature**: Added dropdown menu for Most/Recent Popular and Random posts.
- **Performance**: Implemented strict rate limiting (6 req/s) using Token Bucket algorithm.
- **Fix**: Improved thumbnail loading with video support and quality priority.

### v6.2
- **UI**: Dynamic level-tier colors for usernames in ranking lists.
- **Fix**: Corrected hourly uploads distribution rendering.
- **Feature**: Enabled commentary support for small tags; refined dashboard layout.

### v6.1
- **Feature**: Added resizable and movable layout to GrassApp with per-user IndexedDB storage.
- **Fix**: Fixed duplicate data rendering in UserAnalyticsApp during refresh.
- **Compatibility**: Added support for other Danbooru-compatible boorus and subdomains.

### v6.0
- **TagAnalyticsApp**: Full analytics support for any Tag, Artist, Copyright, or Character — historical trends, rankings, and milestones.
- **Enhanced Progress Tracking**: Real-time, descriptive loading indicators replacing generic messages.
- **Unified Architecture**: Single entry point (`main`), shared `Database`, optimized `SettingsManager`.
- **Smart Button Injection**: Improved analytics button injection across all page layouts.

---

## v5.x — Advanced Analytics

### v5.3
- **Approvals Overhaul**: Migrated to `/post_approvals.json` with server-side filtering for a massive speed improvement.
- **Fix**: Fixed critical fetching bugs (missing `creator_id`, empty current-year data).
- **UX**: Improved loading progress indicators; restored click interactions; added GJS-compliant JSDoc.

### v5.2
- **Stability**: Enhanced sync reliability for large datasets.
- **Performance**: Refined thumbnail selection logic.

### v5.1
- **Feature**: Bubble Chart visualizing Jaccard Similarity vs. Frequency for character tags.
- **Feature**: Added Hair Length and Hair Color analysis tabs to Pie Chart.
- **UX**: Improved Pie Chart interactivity (popup overlay, search navigation).
- **Refactor**: Codebase aligned to Google JavaScript Style Guide with JSDoc.

### v5.0
- **Advanced Approvals Tracking**: Tracks exact Post IDs for approval actions with a paginated "Detail View".
- **Hourly Activity Analysis**: Visualizes contribution intensity by hour of day (00:00–23:00) with a dynamic heatmap.

---

## v4.x — Analytics Dashboard

### v4.5
- **Fix**: Resolved new year / January 1st edge cases in GrassApp date calculation.

### v4.4
- **Feature**: Refined Milestone tracking, Monthly Activity chart, and Post Performance analytics.

### v4.2
- Incremental fixes and UX improvements.

### v4.0
- **Rebrand**: Renamed from *Danbooru Grass* to *Danbooru Insights*.
- **Analytics Dashboard**: Comprehensive dashboard with Tag Distribution, Milestones, and Top Posts.
- **Scatter Plot**: Visualized post scores over time with interactive filtering and zoom.
- **Enhanced Sync**: Background processing and progress indicators.
- **UI/UX**: Refined popovers, smart positioning, and improved modal interactions.

---

## v3.x — Themes & Settings

- **Advanced Theme Customization**: 6 color themes including gradient options.
- **Settings System**: Custom contribution thresholds and visual editors.
- **Performance**: Parallel batch fetching and optimized rendering.
- **Robustness**: Improved DOM independence and error handling.

---

## v2.0 — Core Implementation

- **Core Implementation**: Rebuilt using `d3.v7` and `cal-heatmap`.
- **Local Database**: Integrated `Dexie.js` for IndexedDB storage.
