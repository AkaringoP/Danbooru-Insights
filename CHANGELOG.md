# Changelog

All notable changes to Danbooru Insights are documented here.

---

## v9.8.0 — Grass month-label hover popover

### Added
- **Month statistics popover on the contribution graph.** Hovering (or tapping
  on touch) a month label in the grass heatmap opens a popover summarising that
  month for the currently-selected metric (uploads / approvals / notes):
  - **Total + month-over-month** delta in one headline (`▲/▼ %`, or `new` when
    the previous month had no activity).
  - **Active-day ratio** (active days / calendar days, with a mini bar).
  - **Busiest day** (+ count) and **daily average** (calendar-day basis; the
    in-progress month divides by days elapsed).

  Computed entirely from the year's in-memory daily data — no extra API/DB
  calls. January omits the MoM delta (its previous month is last December,
  outside the loaded year); empty months collapse to a "no activity" line.
  Theming follows the grass palette in both light and dark.

### Changed
- **Mobile mini-report button (📋) resized and relocated.** It now matches the
  sync-settings gear (⚙️) and sits directly after it in the header status row,
  rather than as a large icon beside the analytics entry (📊).

### Fixed
- **Grass interactions survive a theme change.** Switching grass theme
  destroys and re-paints the heatmap SVG; the cell tooltips/clicks, legend
  swatches, and the new month-label popover are now re-attached afterwards
  instead of going inert until the next full re-render. The theme-change
  listener is also de-duplicated so it no longer accumulates per render.
- **Removed redundant top-score API calls on every sync.** A leftover
  `getTopScorePost` (uncached, its result discarded) fired two API requests
  per sync for nothing.

---

## v9.7.2 — Partial-sync staleness fixes

### Fixed
- **Recent / Most Popular posts now refresh on partial (incremental) sync.**
  These API-driven widgets (`order:score`, `age:<1w`) were only re-fetched
  during a full sync, so large users' incremental re-syncs left the cached
  values stale — the post-sync dashboard render served pre-sync data and only
  caught up one open later via SWR revalidate. `refreshAllStats` now refreshes
  them (and the top-score posts) on every sync.
- **Milestones widget no longer freezes at the first-render post count.** The
  widget reads milestones with the default `auto` step, whose cache was never
  warmed by any sync (only `step=1000` was) and had no TTL — so the list stuck
  at whatever count the dashboard first saw while the live progress bar kept
  advancing, corrupting the "% to next milestone" figure. The cache is now
  count-stamped via a sidecar key and invalidated whenever the post count
  changes; the entries payload stays a plain array so the history-chart star
  overlay is unaffected.

### Changed
- **Full-refresh hint relaxed from 7 days to 30 days**
  (`CONFIG.FULL_REFRESH_HINT_DAYS`). Now that partial syncs keep counts,
  popular posts, and milestones fresh, the "full data refresh recommended"
  nudge above the reset button only needs to cover slow older-post metadata
  drift (score / rating / deleted) — a low-urgency, roughly-monthly cadence.

---

## v9.7.1 — Mintag / abandoned upload detection + colour legend

### Added
- **Mintag detection.** A recent upload whose uploader added **≤ 10 tags** (the
  count of tags *that user* added in the post's first version, read from
  `post_versions` `added_tags` — not the post's current total, which others
  inflate) now gets an **orange** label. Replaces the old
  `tag_count_general ≤ 5` heuristic, which wrongly counted everyone's tags.
- **Abandoned detection.** A mintagged upload whose **v2 lands ≥ 15 minutes
  after v1** is re-coloured **red** — the uploader left the post under-tagged
  rather than racing a competing tagger (a v2 within 15 min is treated as a
  tagging race and stays orange). Resolved in a non-blocking background pass
  after the grid renders, guarded against stale popover generations.
- **Colour legend.** A `?` help icon next to the "RECENT UPLOADS" header opens
  a legend (hover on desktop, tap on touch) explaining every border status and
  the orange/red label colours.

### Changed
- **Suspicious-upload label is now score-only** (`score ≤ -3`). The general-tag
  side of the old heuristic moved to the dedicated mintag label above, so the
  red "suspicious" label no longer fires on merely sparse tagging.

---

## v9.7.0 — Dashboard preview popover + created-tags sort headers

### Added
- **Dashboard preview popover.** Hovering the analytics icon (or clicking it,
  for users with ≤30 uploads) now opens a two-section preview instead of a
  plain tooltip. **Section A — Recent uploads:** a grid of the user's newest
  uploads with status borders, a red label on suspicious uploads
  (`score ≤ -3` or `≤ 5` general tags), and a top-right NSFW blur toggle that
  reuses the unified NSFW flag. **Section B — Activity:** a colour-coded strip
  of the most-recent ~200 activities across 11 feed types (uploads, tag edits,
  notes, wiki, artist, commentary, pools, forum, approvals, comments, appeals)
  with a legend.
- **Suspicious-activity detection.** Deleted/banned or heavily-downvoted
  uploads and downvoted comments are re-typed into a separate `suspicious`
  category (near-black + red border). Clicking the **Suspicious** legend item
  opens the *exact* flagged posts via `/posts?tags=id:… status:any`.
- **Legend index links.** Each legend item opens that activity type's Danbooru
  index page with `&limit=200` (the whole analysed window on one page) and an
  `#anchor` that scrolls to the oldest in-window row.
- **Mobile/touch tier.** A dedicated mini-report button (touch only), unified
  loading (one spinner → both sections render together), and two-step-tap
  legends. The popover also follows the dashboard's dark theme.

### Changed
- **Created-tags sort headers.** The Posts/Name/Date segmented control in the
  "Tags created by" table is replaced by per-column sort arrows. Each sortable
  column (Tag Name / Posts / Date) shows a single ▲/▼ arrow that stays hidden
  until you hover the header — except the active sort's arrow, which stays lit
  so the current sort is always visible. The whole header is the click target;
  clicking the active column flips its direction. The Status column is not
  sortable.

---

## v9.6.3 — Translation pie tab + Save/Cancel popover + dark-mode rank bar

### Added
- **TagAnalytics: Translation pie tab.** Mirrors the UserAnalytics
  Translated / Requested / Untagged split for tag-side distribution.
  Untagged is computed via the same 6-query inclusion-exclusion
  formula (`max(0, t − a − b − c + ab + ac)`) so every subquery stays
  at ≤2 real tags and Member(Blue) accounts work without paying for
  a Gold-tier search. `buildUntaggedTranslationQueries` was
  generalized to take a prefix so both user-side (`user:X`) and
  tag-side (`{tagName}`) reuse the same helper.

### Changed
- **TagAnalytics pie tabs split into two rows.** Top row: Copy /
  Char / Status / Rating. Bottom row: Commentary / Translation.
  Copyright / Character labels are shortened to fit four tabs on one
  line at typical modal widths; full names restored on hover via the
  `title` attribute. Commentary / Translation now render
  unconditionally (the legacy commentary-only conditional masked
  the tab whenever cache was missing the field — fresh syncs always
  populate both, and old caches expire within 24h).
- **Settings popovers (UserAnalytics sync settings + TagAnalytics
  settings) commit on Save instead of per-field.** Each popover now
  buffers all edits — Partial Sync Threshold, Count Refresh,
  Dashboard Theme, plus Retention / Sync Threshold on the tag side —
  behind a single `[Cancel] [Save]` action row at the bottom. Save
  starts disabled until something is dirty; Cancel or outside-click
  discards every pending edit (including the theme preview).
  Replaces the per-field ✅ Save buttons that previously committed
  threshold / count fields immediately while the theme select
  applied on change, which made cancellation impossible after
  touching the theme.

### Fixed
- **TagAnalytics ranking row % bar was invisible in dark mode.** The
  per-row gradient fill was a hard-coded `rgba(0,0,0,0.06)` overlay —
  fine as a soft tint on the white card, nearly black-on-black on the
  dark card so the user's share of total uploads couldn't be read at
  a glance. Lifted to `--di-ranking-row-fill` so the dark palette
  swaps in a white wash (`rgba(255,255,255,0.09)`); light mode keeps
  the original via CSS fallback.

---

## v9.6.2 — Dynamic candidate pool + count rerank + char filter unification

### Fixed
- **Char / Copy / Fav legend: hovering the Others row left the previous
  row's sub-chart frozen on screen and its tooltip open.** Others was
  excluded from the legend-row attribute (`data-di-subtag-idx`) so the
  post-render wire-up skipped it entirely — the legend container's
  mouseleave never fires while the cursor is still inside the legend
  rectangle, and Others had no own handler to drive an explicit exit.
  Others now carries the attribute and the wire-up routes it to an
  exit-only handler: chart-mode exits back to the main pie and the
  sub-tag tooltip hides immediately on enter.
- **Character / Copyright / Fav-copyright pie tabs were selecting TOP10
  using `/related_tag.json`'s `frequency`, which is estimated from at
  most 5,000 md5-ordered posts.** Close-frequency pairs (madoka/sensei,
  shiny/cinderella) could swap, and large dispersed-character uploaders
  could lose true top-10 tags beyond the 11+ candidate window entirely
  (Unbreakable-class catalogues at 276k posts). Accurate per-tag count
  was fetched *after* the cut so it only fixed the displayed value, not
  the selection.

  Selection now widens the candidate pool dynamically by total post
  count: 10–80 candidates for character (cap 80), 10–40 for copyright /
  fav-copyright (cap 40). All candidates get accurate
  `/counts/posts.json` counts, then are reranked by count desc →
  frequency desc → tagName asc and truncated to 10. Count-fetch
  concurrency raised from 3 to 6 to absorb the wider pool while staying
  under the rate limiter's 8-slot ceiling.

### Changed
- **Character pie now applies the same `isTopLevelTag` filter** as
  Copyright and Fav-copyright. Costume / ascension variants
  (e.g. `abigail_williams_(first_ascension)_(fate)`) no longer appear in
  TOP10 alongside their base character; they show up via the v9.6.0
  sub-tag breakdown tooltip on the base entry. Resolves the
  double-counting that put variant and base side-by-side in the
  character pie for Fate / Hololive / Blue Archive-heavy uploaders.
- **Char / Copy / Fav pie slice area + legend percentages now ride on
  the accurate `/counts/posts.json` value**, matching every other pie
  tab (rating / status / hair / gender / etc. were already count-based).
  The legacy slice-from-frequency render was inconsistent with the
  count number shown next to the same row — e.g. `sensei: 1,353` with a
  3.0% slice computed from a different, sample-estimated frequency.
  Others slice is now `max(0, N − Σ top10.count)` (clamped at 0 because
  one post can carry multiple character/copyright tags); the Fav tab
  spends one extra `/counts/posts.json?tags=fav:NAME` to use the real
  fav-set size as its base instead of the owner's upload count.

---

## v9.6.1 — Sub-tag tooltip mobile placement fix

### Fixed
- **Sub-tag breakdown tooltip mobile placement.** On touch devices the
  tooltip was anchored to the right edge of the legend row, which spilled
  past the viewport edge — and because mobile disables horizontal
  scrolling, the spilled portion was unreachable (e.g. `idolmaster`
  truncated to `idolm…`). The touch branch now centres the tooltip
  horizontally in the viewport and places it directly below the selected
  row. Desktop placement (right-edge with vertical clamp) is unchanged.

---

## v9.6.0 — Counts refresh, loading progress, tag cloud signatures, widget gating

This release bundles the v9.6 feature cycle: live count refresh with
TTL-tunable freshness, real-time loading progress for both analytics
apps, a more distinctive Tag Cloud General tab, and upload-count gating
for widgets that need a minimum amount of data to be meaningful.

### Added
- **Tag Cloud signature filter** (General tab). The General tab used to
  surface the same set of globally-common tags for every user (`1boy`,
  `simple_background`, `long_sleeves`, `shirt` …) because Cosine-ordered
  selection alone doesn't fully suppress high-volume globals. The cloud
  now drops the 50 most-frequent General tags site-wide, *except* tags
  that the user uses at a notably above-average rate (Lift ≥ 2.0 vs the
  global rate, with a small-sample floor of 3 uses). Result: each user's
  Tag Cloud highlights tags that are actually characteristic of their
  work. Two new globally-shared 24h-cached lookups
  (`/counts/posts.json?tags=status:any` for the global total,
  `/related_tag.json?...&search[query]=status:any&limit=50` for the top
  50) are added in [src/core/global-tag-stats.ts](src/core/global-tag-stats.ts);
  the per-user `/related_tag.json` call now requests `limit=50` for
  General to keep enough headroom after filtering.
- **Sub-tag breakdown tooltip + sub-chart mode on Copy / Fav_Copy / Char
  pie legend.** Hovering (desktop) or tapping (mobile) a top-level
  copyright or character row in the pie chart legend now opens a
  tooltip showing how the user's posts distribute across the parent's
  sub-tags, *and simultaneously swaps the pie chart itself* to that
  parent's sub-tag breakdown. For example, hovering `idolmaster` reveals
  the per-franchise tooltip rows (`deremas 60%`, `milimas 30%`, `Others
  10%`) while the pie redraws to match. Each tooltip row is a link to
  `/posts?tags=user:NAME+sub_tag` in a new tab; hovering a tooltip row
  on desktop also highlights the corresponding slice in the live chart.
  Notable details:
  - The sub-chart's `Others` slice merges two distinct sources: the
    long tail trimmed at the 95% cumulative threshold, plus
    "post-coverage Others" (`parent.count − Σ sub.count`) so the chart
    matches the user's mental model of `top-N + Others`.
  - Parents without sub-tags still drill in — the chart becomes a
    single-slice view of the parent itself when the legend row is
    hovered.
  - Sub-chart counts use `/counts/posts.json` directly (e.g.
    `user:NAME fate/grand_order`) rather than `related_tag` frequencies
    so tooltip + chart percentages match exactly.
  - Sub-tag candidates are batched through `/tag_implications.json`
    with the `consequent_name_comma` filter and cached for 180 days
    under a new `consequent:` key prefix on the existing
    `tag_implications_cache` table — zero per-tag API calls on hover.
  - The legend rectangle (not individual rows) is the boundary for
    sub-chart mode: the cursor can slide between rows or onto the
    body-attached tooltip without flickering back to the main pie.
  - Chart transitions use a sequential fade (chartWrapper fades out,
    data swaps while invisible, fades back in) — matches the
    tag-cloud tab-switch crossfade pattern without the snapshot-overlay
    alignment issues that an earlier symmetric crossfade exposed.
  - The d3 join's update branch resets opacity + filter so the shared
    `Others` slice can't carry stale state from an in-flight
    highlight transition or a leftover `drop-shadow` on main-pie
    return.
  - The legend container's mouseenter/leave listeners are de-duped via
    a `WeakMap` registry so tab switches (which reuse the same
    `legendDiv` element) don't accumulate stale `scheduleExit` timers
    across renders.
- **Widget upload-count gating** for two widgets where small data shows
  noise instead of patterns:
  - Tag Cloud unlocks at 100 uploads
  - Score Distribution (scatter plot) unlocks at 300 uploads

  Below the threshold, a reusable
  [`renderWidgetLockedPlaceholder`](src/ui/widget-locked-placeholder.ts)
  shows a progress bar (`current / required`) and a short explanation
  in place of the widget. The data-layer fetch is skipped entirely when
  gated — small users save one tag-cloud round trip plus the scatter
  data preparation per dashboard open.
- **Real-time loading progress** for both analytics apps. The spinner
  now shows the live phase counter ("Loading dashboard · N/14") plus a
  rotating substatus that reflects what the data layer is actually
  doing (e.g. "Loading character distribution…", per-tag count fetch
  progress). Replaces the static "Analyzing contributions" text.
- **Count cache freshness window** (configurable). 11 count-driven
  distributions plus Created Tags now honour a TTL (default 10 minutes,
  user-settable from the analytics settings popovers). Previously the
  piestats cache was "trust until reset" — distributions could go
  arbitrarily stale between syncs.

### Fixed
- **Top-level tag detection now ignores deleted/declined/retired
  implications.** `/tag_implications.json` queries previously omitted
  `search[status]=active`, so historic implications counted toward
  sub-tag judgement. Users with copyrights that *used to* imply a
  parent tag (e.g. `ninjago → the_lego_group`, now status=deleted)
  were incorrectly excluded from the copyright pie. Cache records are
  invalidated via an embedded schema version
  (`IMPLICATIONS_CACHE_SCHEMA_VERSION = 2`) so pre-v9.6 entries are
  refetched automatically.
- **Random / Recent / Most Popular post cards now filter to
  `status:active`.** Without this, the Random Post pick could land on
  a banned or deleted post and render as a blank thumbnail card
  (reported by user). The same filter is applied to Top Posts (per
  rating) and Recent Popular Posts so a banned high-score post no
  longer occupies the top slot of either widget.
- **Tag Cloud cache now honours TTL + sync invalidation.** The
  `tag_cloud_*` piestats records were previously trust-until-reset,
  so users who had cached results from before v9.6.0 kept seeing
  pre-Lift-filter clouds (with `1girl`, `1boy`, etc.) indefinitely.
  Cache reads now apply the same TTL as the count distributions
  (default 10 min), and `refreshAllStats` force-refreshes all four
  category tabs on partial / full sync — matching the staleness
  contract documented elsewhere in v9.6.0.

### Changed
- **Scatter Plot Score-tab grid density** is now adaptive. The Y-axis
  step size picks the nicest round value (multiples of 1, 2, 2.5, 5,
  10 × 10^N) closest to `maxVal / 6`, so users with a small score
  range and users with a large score range both see ~6 grid sections
  at consistent density. Previously the step was hard-tiered (50, 100,
  500), which gave only 3 sections to typical-range users.
- **Status/Rating SWR revalidate now honours the count-cache TTL.**
  Previously, opening the dashboard fired two background API calls
  (status + rating distribution) on every open, regardless of cache
  age or whether the user had uploaded anything. The SWR helper now
  takes an optional `maxAgeMs` and skips the background revalidate
  when the cache is younger than the TTL, matching the 9 other
  count-driven distributions and the user's "Count Refresh (min)"
  setting. Partial-sync trigger still refreshes everything as before
  (via `refreshAllStats`), so a delta past the Partial Sync Threshold
  still forces fresh counts even within the TTL window.

### Changed
- `RateLimitedFetch` concurrency bumped 6 → 8 and rps 6 → 9 to absorb
  the new TTL-driven refresh fan-out without inflating wall-clock load
  time. Stays under the Danbooru 10 req/s server cap.

### Internals
- `src/core/data-manager.ts:getStats` gains an optional `maxAgeMs` arg
  for the count-cache TTL path. Legacy callers (no arg) keep the
  trust-until-reset semantics.
- `src/apps/tag-analytics-app.ts` overlay refresh: a new
  schema-additive `countsUpdatedAt` field separates count-overlay
  freshness from the 24h report cache.

---

## v9.5.4 — Auto-tune preview anchors + Notes click target

### Changed
- **Threshold auto-tune preview modal** now annotates each row with the
  source of its proposed value: `Level 1 (≥1)` for the fixed L1 cutoff,
  `Level 2 (P40)` / `Level 3 (P70)` / `Level 4 (P90)` for the percentile-
  driven levels. A small footer beneath the table explains the notation
  ("Px = x-th percentile of active-day counts."). Helps when manually
  editing thresholds in the popover afterward — the user can see whether
  the proposed value came from a near-the-middle (P40) or far-tail (P90)
  percentile of their own activity. UI-only; tuning math
  ([src/core/threshold-tuner.ts](src/core/threshold-tuner.ts)) is
  unchanged.

### Fixed
- **Notes-metric grass-cell click** now navigates to `/note_versions`
  filtered by updater + created_at, showing the actual note edits the
  user made on that day. Previously the click target was
  `/posts?tags=noteupdater:USER+date:DATE` — the intersection of
  "posts whose notes user X has ever edited" with "posts uploaded on
  date Y" — which excluded most edit days, because users typically
  translate *older* posts on a given day. The new URL mirrors the
  `/note_versions.json` fetch already used by `getMetricData` in
  [src/core/data-manager.ts](src/core/data-manager.ts) (`search[updater_id]`
  + `created_at`), so the page contents match the tooltip count
  one-to-one.

---

## v9.5.3 — Approvals year dropdown for users with later promotions

### Fixed
- **Approvals year selector** now correctly shows the year a user first
  became an Approver, even after they've been promoted further (e.g.
  Approver → Moderator). Previously,
  `DataManager.fetchPromotionDate` queried
  `/user_feedbacks.json?search[body_matches]=to+Approver&limit=1`
  without an order parameter, which returns newest-first. For a user
  whose most recent feedback is "promoted to a Moderator level account
  from Approver", the body still tokenises as `to` + `Approver`, so the
  query matched and returned that 2026 entry — hiding 2025 from the
  Approvals dropdown despite real approval activity from late 2025.
  Fix fetches `limit=20` and picks the oldest entry by `created_at`
  client-side, which is unambiguously the first promotion to Approver.

---

## v9.5.2 — Legend tap targets on mobile

### Fixed
- **Grass legend swatches now respond reliably to taps on mobile.**
  The five Less/More color swatches at the bottom-right of the grass
  graph only had `mouseover` / `mouseout` handlers — on touch devices
  the synthetic mouse events fired unreliably, and `mouseout` from
  the next tap collapsed the tooltip immediately after it appeared.
  Mirrored the v9.4.8 hourly-grid / v9.5.1 cell pattern: on
  `isTouchDevice()` build a `createTwoStepTap` controller with
  `navigateOnSameTap: false`, attach `TapTracker`-gated
  `touchstart` / `touchmove` / `touchend` per swatch with an
  `AbortController`-grouped signal so re-renders don't stack
  listeners, and position the tooltip above the swatch via the
  existing `positionTooltipAboveCell` helper. Hit area expanded to
  ~24×24 px (`padding: 7px; box-sizing: content-box;`) — the visible
  10×10 swatch is unchanged. Desktop hover behavior is untouched.

---

## v9.5.1 — Hotfixes: mobile approval tooltip + post-paint handler race

### Fixed
- **Mobile approvals tooltip tap now opens the post-list popover.** The
  desktop click handler on a grass cell special-cased the `approvals`
  metric to open `showApprovalsDetail` (paginated list of post IDs
  approved that day), but the mobile two-step-tap path only routed
  through `getUrl()`, which returns `'#'` for approvals — so the
  tooltip tap closed silently with no popover. The mobile path now
  mirrors the desktop branch, synthesizing `pageX` / `pageY` from the
  tooltip's bounding rect so the popover positions next to the
  tooltip the user just tapped (`graph-renderer.ts:onSecondTap`).
- **Cells and legend swatches stay clickable after a threshold edit
  / auto-tune Apply / Undo.** v9.5.0's `applyAndOfferUndo` flow can
  re-render the grass while the settings popover is still open, and
  fast Apply→Undo (or rapid threshold edits) can fire a second
  `renderGraph` before the prior render's 300ms post-paint
  `setTimeout` resolves. The stale timeout then ran
  `d3.selectAll('#cal-heatmap-scroll rect')` against an
  already-destroyed selection, leaving the freshly-painted cells
  (and the legend tooltip handlers, since the legend divs survive
  CalHeatmap.destroy() and a stale timeout would last-write-wins
  overwrite them with stale closures) without working click /
  mouseover handlers. Tracked the pending id on the renderer
  instance and clear it both at `renderGraph` entry and on each
  reschedule, so only the latest render's handler-attachment pass
  ever runs.

---

## v9.5.0 — Threshold auto-tune (per-profile)

The grass-graph thresholds (Level 1–4) can now be auto-tuned from the
viewed profile's recent 180 days of activity, with results stored as a
**per-profile override** so that tuning one profile never breaks the
visualization on another. The popover gets an auto-tune button, and the
graph proactively suggests tuning via a toast when the active-day
distribution looks saturated. No schema changes.

### Added
- **Auto-tune button in settings popover** (Set thresholds header,
  sparkles icon). One click, single metric (whichever is selected in
  the dropdown), reads the last 180 days of active-day counts
  (`count > 0`) from IndexedDB, and computes thresholds as `L1=1`
  (fixed) plus P40/P70/P90 of the sample with strict-increasing
  correction. The user previews the proposed values vs. the current
  ones in a modal before applying. Closing the modal (Cancel, ESC, or
  backdrop click) now keeps the underlying settings popover open —
  modal click events are scoped so they don't trigger the popover's
  click-outside dismissal. Backed by
  [src/core/threshold-tuner.ts](src/core/threshold-tuner.ts) + 23
  unit tests.
- **Auto-tune suggestion toast** after each grass render. Triggers only
  when ≥90% of active days fall into the L1 or L4 bucket *and* a
  simulation shows that proposed thresholds would reduce max-bucket
  concentration by ≥20 percentage points. Skips when the profile
  already has an override or was dismissed in the current session.
  Inline `[Apply] [Dismiss]` buttons on the toast (new
  `actions?: ToastAction[]` option on `showToast`).
- **Per-profile threshold storage**: new optional
  `SettingsData.perProfileThresholds: Record<userId, Partial<ThresholdMap>>`
  with `getThresholdsForView(userId, metric)` taking precedence over the
  global default at render time. Manual input edits in the popover stay
  global (user's "baseline preference"); auto-tune and the suggestion
  toast write per-profile.

### Changed
- `graph-renderer.ts` rendering paths now resolve thresholds via
  `getThresholdsForView` (cell paint + legend tooltip) so per-profile
  overrides actually take effect.
- Settings popover threshold inputs are now WYSIWYG: they read the
  active layer (`getThresholdsForView`) and write back to whichever
  layer is active (`setProfileThresholds` if the current profile has
  an override for that metric, else `setThresholds`). Validation runs
  against the active layer. Auto-tune `Apply` re-renders the inputs
  immediately so they reflect the just-saved per-profile values
  instead of the previous global ones.
- `ThresholdMap` is now a 4-tuple type (`Threshold4 = [number, number,
  number, number]`) instead of `number[]`, locking the length-4
  invariant at compile time across `computeAutoThresholds`,
  `simulateDistribution`, `wouldTuningImprove`, `detectSaturation`,
  and the popover/modal APIs. `getThresholds` and
  `getThresholdsForView` now also runtime-validate stored entries
  (`isThreshold4` guard — must be Array, length 4, all numbers) so
  hand-edited or corrupt localStorage entries can't leak undefined
  values into the cell-paint code at `t[3]`.
- **Auto-tune scheduler** — opt-in cadence-based sweep that runs on each
  profile visit and proposes refreshing per-profile thresholds when a new
  period boundary has passed. New checkbox + dropdown row in the settings
  popover ("Auto-tune every Month / Quarter / Half year / Year"). Default
  is disabled with `Half year` selected. Boundaries are always the 1st of
  the relevant period (no day picker). When triggered, a single prompt
  toast lists the candidate metrics for the current profile (e.g.
  `Scheduled auto-tune ready: Uploads, Approvals. [Apply] [Dismiss]`);
  Apply tunes them in one batch and surfaces a combined Undo, Dismiss
  marks the period as handled so it won't re-prompt until the next
  boundary. Backed by `mostRecentBoundary` in `threshold-tuner.ts` (8
  unit tests covering every interval) and per-(profile, metric) tune
  timestamps stored under `SettingsData.perProfileTuneTimes` (8 unit
  tests). Scheduler runs *before* the saturation prompt and short-circuits
  it on the same render so the user is never double-prompted.
- Auto-tune `Apply` (both the manual modal and the auto-detect toast)
  now triggers the graph re-render *immediately* and keeps the settings
  popover open. The follow-up success toast carries an `Undo` action
  (8s window) that restores the prior state — either the previous
  per-profile override (via `setProfileThresholds`) or the bare global
  fallback (via the new `clearProfileThreshold` helper, which also
  drops empty per-profile entries). Undo additionally calls
  `dismissSuggestion` so the auto-detect toast won't immediately
  re-prompt the user who just walked it back.
- Threshold preview modal redesign: per-level Before/After grid with
  swatch + arrow (↑ ↓ =) per row, monospace tabular numerals, and the
  modal now picks up the active grass theme's light/dark palette via
  `applyPopoverPalette` (previously stayed white on dark themes).
- Settings popover now refreshes its threshold inputs every time it is
  opened (`createSettingsPopover` exposes a new `refresh(metric?)`
  method, called from the gear button's open path with the current
  main metric). This (a) surfaces the toast-driven Apply path's
  per-profile changes — previously the popover element was constructed
  once and its inputs only updated on modeSelect change, so a
  per-profile write that happened while the popover was closed stayed
  invisible until the user manually toggled the dropdown — and (b)
  aligns the popover's metric dropdown with whatever the user is
  actually viewing in the main grass each time the popover opens
  (previously frozen at first-render metric).

### Polish (added during the same release window)
- **Settings popover layout reshuffle**: the Snap-to-edge row moved from
  the bottom of the threshold section up between the theme grid and the
  "Set thresholds" header, with a horizontal divider above the threshold
  section (mirroring the existing Cache Info divider). All
  threshold-related controls (mode dropdown, Level 1–4 inputs,
  auto-tune scheduler) are now visually grouped.
- **Help (?) icon on the schedule row** — hover on desktop, tap on mobile,
  keyboard-accessible (Enter / Space / Esc), themed via
  `applyPopoverPalette` so light/dark grass themes carry through. Custom
  tooltip (not native `title`) so it works on touch devices. Lists what
  each interval boundary maps to (e.g. *Half year · 1st of Jan / Jul*).
- **`ToastOptions.onClose`** — fires when the user closes a toast via the
  × button or the auto-dismiss timer, NOT when an action button is
  clicked (a `actionTriggered` flag short-circuits). The auto-tune
  suggestion and scheduler prompts both wire `onClose` to
  `dismissSuggestion(userId)` so X'ing out either flavor session-dismisses
  both — refresh restores them. Keeps "X = silence me for now" distinct
  from `Dismiss` (which marks the period itself as handled in the
  scheduler case).
- **Manual auto-tune button now skips the modal when proposed values
  match the active thresholds** — applying would be a no-op, so the
  button just shows an info toast (`<Metric> thresholds already match
  the recent activity — nothing to change`) and returns.
- **Schedule row alignment fix**: removed the `popover-select` class from
  the schedule dropdown — it forces `width:100%` and a bottom margin
  which broke the inline flex layout. Replaced with explicit inline
  styles matching the surrounding 11px text height.
- **Apply button hover regression**: Danbooru's global
  `button:hover { background: white }` was outranking the modal's
  primary-button background, painting white text on white background
  on hover. Restated `background` / `color` / `border-color` on
  `:hover` / `:focus` / `:active` with `!important` so host stylesheets
  can't repaint our buttons mid-interaction. Cancel button protected
  the same way.
- **Modal click-isolation**: clicking Cancel / backdrop in the auto-tune
  preview modal also dismissed the underlying settings popover because
  the click bubbled to document, where the popover's "click outside"
  handler caught it. Modal backdrop and card now `e.stopPropagation()`.

### Migration
- Existing users get an empty `perProfileThresholds` object on next
  load (deep-merge in `SettingsManager.load`). The new
  `autoTuneSchedule` and `perProfileTuneTimes` fields also start empty.
  No action needed.
- No IndexedDB schema change; current schema v12.

---

## v9.4.8 — Hotfix: Hourly Distribution tooltips on mobile

The Hourly Distribution panel in the GrassApp summary widget had two
mobile-only failures: the tooltip often didn't appear when a cell was
tapped, and once it did appear, tapping a different cell wouldn't
update or dismiss it. No schema changes.

### Fix
- **Hourly cells now drive their tooltip from real touch events**: the
  per-cell handlers in `updateSummaryGrid` were `onmouseenter` /
  `onmouseleave` only, which on iOS Safari + Chrome Android rely on
  synthetic mouse events fired after a tap. Those fire unreliably and
  often leave the cell stuck in a hover state, so subsequent taps on
  other cells were ignored. Mirrored the pattern already used by the
  CalHeatmap year grid: branch on `isTouchDevice()`, attach
  `touchstart` / `touchmove` / `touchend` via a per-cell `TapTracker`
  (15 px / 600 ms tap budget — drags still scroll), and route
  recognised taps through a `createTwoStepTap` controller. The
  controller manages the active-cell state and handles outside-tap
  dismiss (document-level `touchstart` / `click`), so tapping another
  cell moves the tooltip and tapping anywhere off the grid hides it.
  Desktop hover behaviour is unchanged.
- **Tooltip no longer clips above the viewport top**: extracted a
  `positionTooltipAboveCell` helper that flips the tooltip below the
  cell when there isn't room above, and clamps it horizontally inside
  the viewport. Used by both the touch and desktop paths so the AM-row
  cells (which sit near the top of the panel) render their tooltip
  correctly when the panel is at the top of the page.

---

## v9.4.7 — Hotfix: Milestones expanded-state cut-off

Follow-up to v9.4.6. The collapsed-state cut-off was fixed in v9.4.6, but
users with many milestones (~20+ rows on mobile's 2-column layout) were
still seeing the last row sliced in half once they clicked "Show More".

### Fix
- **Expanded milestone grid now sizes to actual content height**: the
  expanded-state `max-height` was hardcoded to `2000px`, which on mobile
  fits ~19 rows of ~100px cards before clipping the next row mid-card —
  so a user with 38+ milestones (~20 rows) lost the last row right above
  the "Monthly Activity" heading. The two `'2000px'` assignments in
  `renderMilestonesWidget` (initial render when already expanded, and
  inside the Show More click handler) now use
  `milestoneContainer.scrollHeight + 'px'` instead, so the container
  expands to exactly fit whatever the current milestone step (1k, 2.5k,
  5k, repdigit, …) produces. The existing `transition: max-height 0.3s
  ease` animates smoothly from collapsed (90px mobile / 110px desktop)
  to the computed scrollHeight.

---

## v9.4.6 — Hotfix: User Analytics milestones display on mobile

Two small but visible regressions in the User Analytics milestones widget
on mobile. No schema changes.

### Fixes
- **NSFW milestone cards no longer collapse into a 45×45 box**: the mobile
  CSS rule that resized the thumbnail wrapper (`#analytics-milestone-container > a > div:last-child`)
  fell through to the text div whenever the thumbnail was omitted (NSFW
  filter off + NSFW post), squeezing the card so the date wrapped onto two
  lines and "Score:" was clipped. Scoped the rule to
  `:last-child:not(:first-child)` so it only matches when an actual
  sibling thumbnail exists.
- **Collapsed milestone grid no longer cuts cards mid-row on mobile**: the
  inline `max-height:110px` showed one full row plus ~25–30px of the next
  row on mobile (cards are ~75–80px tall with the smaller padding/thumb),
  so the next row's cards were sliced in half right above "Monthly
  Activity". Moved collapse height onto a `.di-milestone-collapsed` class
  and overrode it to `90px` inside the `(max-width: 768px)` block; the
  Show More / Show Less toggle now flips the class alongside the existing
  inline max-height.

---

## v9.4.5 — Pie chart UX overhaul + dashboard isolation

Mobile-focused polish pass on the User Analytics pie-chart widget plus
three security/correctness fixes surfaced by code review, and a
dashboard-isolation pass so the modal fully covers the underlying
Danbooru profile page when open. The pie chart's mobile interaction model
has been rebuilt around explicit tap detection, far-side tooltip
placement, and a tag-cloud-style crossfade between tabs. No schema
changes.

### Security
- **Pie tooltip / legend XSS hardening**: every interpolation site that
  fed `tooltip.html(...)` or `legendDiv.innerHTML` (slice label, color,
  thumbnail URL) now goes through `escapeHtml` / a `safeColor` whitelist
  (`/^#[0-9a-fA-F]{3,8}$/`) / `safeThumbUrl` (donmai.us host whitelist).
  Test coverage in `test/pie-escape.test.ts` (17 cases). Closes a
  long-standing path where a malicious tag label or `details.thumb`
  (merged via the async `DanbooruInsights:DataUpdated` event) could
  break out of an attribute and execute on the Danbooru origin.

### Correctness
- **Pie percentages now sum to exactly 100%**: independent rounding per
  slice could yield 33+33+33=99 or 16.67×6=102. New `computePercentages`
  (largest-remainder method) is called once after `processedData` and
  the resulting `pctByLabel` is shared by tooltip + legend so the two
  displays also agree on precision. Test coverage in
  `test/pie-percentages.test.ts`.
- **`PieSlice.details` is now a discriminated union**: the previous
  `details: any` (with an `eslint-disable` to match) let typos and
  backend-schema drifts pass through to URL builders silently.
  `kind: 'rating' | 'status' | 'tag'` with branch-specific fields, plus
  a single `buildSearchQuery(details, ...)` helper that both
  `handlePieClick` and the legend builder call (replacing the "Mirror
  handlePieClick's logic" duplicated branch). Test coverage in
  `test/pie-search-query.test.ts`. `window.open(url, '_blank',
  'noopener,noreferrer')` applied as part of the same pass.

### Dashboard isolation
- **iOS-safe page scroll lock**
  (`feat(modal): scroll-lock 유틸 + iOS-safe 페이지 잠금`):
  `document.body.style.overflow = 'hidden'` alone is unreliable on iOS
  Safari (rubber-band still leaks the page underneath). New
  `src/core/scroll-lock.ts` puts `body { position: fixed;
  top: -savedScrollY; width: 100%; overflow: hidden }` and matches
  `html { overflow: hidden }` while a modal is open, restoring
  everything (and `window.scrollTo(0, savedScrollY)`) on close.
  UserAnalytics + TagAnalytics both call the helper. Refcount supports
  nested locks. Test coverage in `test/scroll-lock.test.ts` (4 cases).
- **Modal fully covers the underlying profile page**:
  `#danbooru-grass-modal-overlay` background changed from
  `rgba(0,0,0,0.4)` to opaque (`var(--di-overlay-bg, var(--di-bg,
  #1a1a2e))`). `#danbooru-grass-modal-window` height is now 100% (was
  80%, leaving a vertical bleed-through gap on desktop).
  `#tag-analytics-modal > div` `max-height: 90vh → 100dvh` for iOS
  address-bar safety.

### Pie chart mobile UX
- **Slice hover/3D clipping resolved**: chart wrapper grew from 180×180
  to 220×220 (`PIE_SVG_SIZE` / `PIE_RADIUS` constants extracted).
  Visible chart diameter still 140 px; the extra 40 px headroom absorbs
  `arcHover` (1.2× outer radius) plus the `rotateX(40deg)` 3D
  projection so popped slices no longer collide with the legend's
  sticky header on mobile.
- **Tap-completion semantics**: a single tap on a slice was previously
  perceived as "tooltip + immediate navigate" because the synthetic
  `click` browsers fire after a tap landed on the just-shown tooltip.
  New `TapTracker` (`src/ui/two-step-tap.ts`) gates both slice → tooltip
  and tooltip → navigate on completed taps (touchstart + touchend,
  ≤15 px move, ≤600 ms), and the slice's d3-bound datum is captured at
  touchstart instead of re-resolved via `document.elementFromPoint`
  (which often returned the parent `<g>` on a 3D-rotated SVG, silently
  dropping a large fraction of taps). `mouseover`/`mousemove`/`mouseout`
  are now `if (isTouch) return;` guarded so the synthetic mouse cascade
  doesn't overwrite the tooltip's position. Test coverage in
  `test/tap-tracker.test.ts` (9 cases).
- **Tooltip stays inside the card**: tooltip placement is no longer
  "touch + 15 px offset and clamp" but a priority list of candidate
  positions (4 touch-relative quadrants, then card-far-side anchors
  with 5 vertical alignments). The first that fits inside `cardRect ∩
  wrapperRect ∩ viewport` wins. Tooltip natural width is preserved —
  only the position changes — and the `body { overflow-x: hidden }`
  from the scroll lock is the safety net for the pathological
  "tooltip wider than card" case. Test coverage in
  `test/pie-tooltip-position.test.ts` (8 cases).
- **Tooltip pointer-events sync**: a hidden (`opacity: 0`) tooltip used
  to keep `pointer-events: auto` and its previous position, eating the
  next tap on the slice underneath. Pointer-events is now toggled in
  lockstep with opacity (`auto` while shown, `none` while hidden).
- **Slice highlight resets after navigation**: `onSecondTap` now calls
  `resetSlices()` after `handlePieClick` so coming back via
  browser-back finds the chart in its default arc shape instead of a
  frozen `arcHover` slice with no `activeDatum` to dismiss it.
- **Tab transition crossfade**: the mobile-only `filter: blur(6px) +
  opacity: 0.5 + 380 ms` effect is replaced with the same 350 ms
  opacity crossfade pattern the tag-cloud widget uses. A `cloneNode`
  snapshot of the current chart + legend overlays `pieContent` while
  d3 re-renders the originals underneath, then fades out — desktop
  and mobile share the same animation now.

### Internal
- New helpers: `src/core/scroll-lock.ts`,
  `src/ui/two-step-tap.ts::TapTracker`,
  `src/apps/user-analytics-pie-helpers.ts` (`pickFittingPosition`,
  `computePercentages`, `safeColor`, `safeThumbUrl`,
  `buildSearchQuery`),
  `src/ui/two-step-tap.ts::TwoStepTapOptions.navigateOnSameTap`.
- Tests: 27 files / 343+ cases (was 20 / ~280). All new cases run in
  vitest's node environment with `vi.stubGlobal('document', ...)` for
  DOM-touching code.

---

## v9.4.4 — Zero-post empty-state handling

Hotfix for a broken UX path on subjects with no posts. Opening the
User Analytics dashboard on a profile with 0 uploads previously triggered
a sync attempt that 404ed on `/posts/random.json` and reset the dialog
back to the start. The Tag Analytics flow on a 0-post tag silently
returned with the status label stuck at "Waiting...". No schema changes.

### Fixes
- **User Analytics** ([`hotfix/zero-post-user-empty-state`]): when
  `getTotalPostCount` reports 0 and the local DB is empty, `renderDashboard`
  now short-circuits before `fetchDashboardData` and renders an
  empty-state panel ("No uploads to analyze"). `updateHeaderStatus`
  treats `total === 0` as vacuously fully synced so the header pill no
  longer turns red and the menu click no longer triggers
  `performPartialSync`. `performPartialSync` itself early-returns on
  `syncTotal === 0` as a defensive backstop so the
  `syncAllPosts → refreshAllStats → /random.json` 404 cascade can no
  longer fire.
- **Tag Analytics**: `_fetchAndRender` now distinguishes a null
  `initialStats` (fetch failure, kept as silent log.warn) from
  `totalCount === 0` (empty tag). The latter renders an empty-state
  modal mirroring the User Analytics pattern, so the analytics button
  on a tag with no posts no longer leaves the user staring at a
  "Waiting..." label.

---

## v9.4.3 — Scatter Y-grid threshold filter

Adds an interactive Y-axis grid affordance to the User Analytics "Post
Performance" scatter plot, plus a mobile layout fix for the downvote
filter pill. No schema changes.

### UX
- **Interactive Y-grid threshold** (scatter plot): hovering a Y-axis grid
  label (e.g. `50`, `100` on Score; `25`, `75` on Tag Count) dims points
  below that value and draws a dashed blue threshold line at `y = N`. The
  bottom count badge updates to show only the matching post count
  (`123 items`). Clicking the label opens
  `/posts?tags=user:<name> score:>=N` (or `gentags:>=N` in Tag Count
  mode) in a new tab. On touch devices the affordance follows the
  established two-step tap pattern (first tap highlights, second tap
  navigates, outside tap resets). The existing Tag Count `Y=10`
  affordance is preserved verbatim — `Y=10` is excluded from the new
  ">=N" interaction so the `<10` highlight + tooltip continues to work
  unchanged. `Y=0` and the topmost grid value are also excluded
  (degenerate cases). The threshold auto-clears on mode toggle, year
  zoom in/out, and drag-select to avoid stale highlights when the
  underlying scale changes.
- **Downvote pill order on mobile** (`hotfix/scatter-downvote-mobile-order`):
  the v9.4.2 mobile fix made `.di-scatter-filter` and
  `.di-scatter-downvote` `position: static`, but DOM append order put
  the downvote pill *above* the chart instead of below the
  `891 items / G S Q E` count badge. Reordered the `appendChild` calls
  so the mobile static-flow stack ends with
  `[toggle][chart][filter][downvote]`. Desktop is unaffected — both
  pills stay absolute-positioned at `top:15px` / `top:45px right:15px`.

### Internal
- New pure helpers `getEligibleYThresholds(scale)` and
  `buildPostsUrlForThreshold(userName, mode, value)` exported from
  `src/apps/user-analytics-scatter.ts` for unit testing. 10 new tests
  in `test/user-analytics-scatter.test.ts` cover the eligibility
  filter (excludes 0, the topmost value, and `Y=10` in tag mode) and
  the URL builder (uses `score` for Score mode, `gentags` for Tag
  Count mode, encodes user names with whitespace).

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
