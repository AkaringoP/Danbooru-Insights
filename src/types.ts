// Shared interfaces and type aliases for DanbooruInsights.

/**
 * Escape hatch for d3 selections, scales, transitions, and datums.
 *
 * Per CLAUDE.md ("`d3` is typed as `any` — do not add `@types/d3` (breaks
 * app file typing)"), d3 lacks first-class TypeScript types in this
 * project. Use this alias **only at d3 call sites** instead of bare `any`
 * so:
 *   1. The intent is auditable in code review (you can grep `D3Any` to
 *      find every d3 escape hatch).
 *   2. The `@typescript-eslint/no-explicit-any` rule stays universally
 *      enforced as `error` everywhere else — no file-level overrides.
 *   3. If d3 typing improves later, removing the alias is a single
 *      mechanical find-replace.
 *
 * Do **not** use `D3Any` for non-d3 reasons (API responses, JSON, lazy
 * typing). Those must use real types and will be caught in review.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type D3Any = any;

/**
 * Escape hatch for CalHeatmap (https://cal-heatmap.com/) instances and
 * options. Mirrors the `D3Any` pattern: there is no `@types/cal-heatmap`
 * package, and CalHeatmap is loaded as an external global at runtime via
 * `@require` / `externalGlobals` (see CLAUDE.md "External Dependencies").
 *
 * Use this alias **only at CalHeatmap call sites** (e.g. `new CalHeatmap()`,
 * `cal.paint(...)`, `cal.on(...)`). Do not use it for non-CalHeatmap reasons.
 * Grep for `CalHeatmapAny` to audit every usage.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CalHeatmapAny = any;

/** A named grass (heatmap level) color palette. */
export interface GrassOption {
  name: string;
  /** Five-step color ramp [empty, level1, level2, level3, level4]. */
  levels: string[];
}

/** A color theme definition for the contribution graph. */
export interface Theme {
  name: string;
  bg: string;
  empty: string;
  text: string;
  /** Five-step color ramp for contribution levels (lightest → darkest). */
  levels?: string[];
  /** Custom scrollbar thumb color. */
  scrollbar?: string;
  /** Selectable grass color palettes (4 options per theme). */
  grassOptions?: GrassOption[];
}

/**
 * Four-element threshold tuple [L1, L2, L3, L4]. Always strictly increasing
 * after validation. Locking the length at the type level removes a class of
 * runtime errors (`vals[3]` becoming undefined) and lets the storage layer
 * narrow length-4 invariant at compile time.
 */
export type Threshold4 = [number, number, number, number];

/** Threshold values for each contribution metric. */
interface ThresholdMap {
  uploads: Threshold4;
  approvals: Threshold4;
  notes: Threshold4;
}

/** Cadence options for the auto-tune scheduler. All boundaries fall on the
 *  1st of the relevant period. */
export type ScheduleInterval =
  | 'monthly' // 1st of every month
  | 'quarterly' // 1st of Jan / Apr / Jul / Oct
  | 'semiannual' // 1st of Jan / Jul
  | 'yearly'; // 1st of Jan

export interface AutoTuneSchedule {
  enabled: boolean;
  interval: ScheduleInterval;
}

/** Dark mode preference: auto follows Danbooru, or forced light/dark. */
export type DarkModePreference = 'auto' | 'light' | 'dark';

/** Persisted user settings stored in localStorage. */
export interface SettingsData {
  theme: string;
  thresholds: ThresholdMap;
  /** Maps userId → last used metric mode. */
  rememberedModes: Record<string, string>;
  /**
   * Per-profile threshold overrides, keyed by viewed userId. Each entry may
   * cover a subset of metrics — unset metrics fall through to the global
   * `thresholds`. Set by the auto-tune button or saturation-detection prompt.
   */
  perProfileThresholds?: Record<string, Partial<ThresholdMap>>;
  /**
   * Auto-tune scheduler config (global toggle + cadence). When enabled, the
   * grass renderer runs an auto-tune sweep on each profile visit if the
   * current period boundary has not yet been handled for that profile.
   */
  autoTuneSchedule?: AutoTuneSchedule;
  /**
   * Per-profile, per-metric "last decided this period" timestamps (epoch
   * ms). Updated whenever the user takes a definitive action on a tuning
   * prompt (Apply / scheduler Dismiss) so the scheduler skips profiles
   * already handled in the current period.
   */
  perProfileTuneTimes?: Record<string, Partial<Record<Metric, number>>>;
  /** Max post-count diff allowed before triggering an automatic sync. */
  syncThreshold?: number;
  /** Per-theme grass palette index (themeKey → 0-3). */
  grassIndexByTheme?: Record<string, number>;
  /** Dark mode preference (default: 'auto'). */
  darkMode?: DarkModePreference;
  /** Enable magnet-snap when resizing grass to full width (default: true). */
  snapToEdge?: boolean;
}

/** Contribution metric identifier. */
export type Metric = 'uploads' | 'approvals' | 'notes';

/** Target user profile extracted from the DOM. */
export interface TargetUser {
  name: string;
  normalizedName: string;
  id: string | null;
  created_at: string;
  joinDate: Date;
  level_string: string | null;
}

/** Aggregated metric data for a single year. */
export interface MetricData {
  /** Maps ISO date strings (YYYY-MM-DD) to post counts. */
  daily: Record<string, number>;
  /** Post counts indexed by hour-of-day (0–23). */
  hourly: number[];
}

/**
 * Per-month activity summary for the grass month-label hover popover.
 * Computed purely from a single year's `daily` map (no DB/network) by
 * `computeMonthStats` in `src/core/grass-month-stats.ts`.
 */
export interface MonthStats {
  year: number;
  /** 0-indexed month (0 = January). */
  month: number;
  metric: Metric;
  /** Sum of the month's daily counts. */
  total: number;
  /** Days in the month with count > 0. */
  activeDays: number;
  /**
   * Calendar-day denominator: full days-in-month for a past month, days
   * elapsed for the in-progress month, 0 for a future month.
   */
  denominatorDays: number;
  /** activeDays / denominatorDays (0 when denominatorDays is 0). */
  activeRatio: number;
  /** Highest-count day, ties broken toward the earliest date. Null if empty. */
  busiest: {date: string; count: number} | null;
  /** total / denominatorDays, rounded to 1 decimal (0 when denom is 0). */
  average: number;
  /**
   * Month-over-month change vs the previous month, in percent. Null when it
   * cannot be computed — January (previous month is last year, out of the
   * in-memory year) or a zero previous total with no current activity.
   */
  momPct: number | null;
  /** Previous total was 0 but this month has activity → show "new" not a %. */
  momIsNew: boolean;
  /** total === 0 → popover collapses to a "no activity" line. */
  empty: boolean;
  /**
   * Per-day counts for the popover's sparkline, index 0 = the 1st. Sized to
   * the days that have actually happened: a full month for a past one, only
   * the elapsed days for the in-progress one (so the chart doesn't end in a
   * run of fake zeroes), and empty for a future month.
   */
  series: number[];
  /**
   * Per-month totals for the whole year, index 0 = January — the context the
   * daily `series` lacks (where this month sits among its siblings). Sized
   * like `series`: all twelve for a finished year, only the elapsed months
   * for the current one.
   */
  yearSeries: number[];
}

/** Danbooru post media variant (modern API). */
export interface PostVariant {
  type: string;
  url: string;
  file_ext: string;
  width?: number;
  height?: number;
}

/** GrassApp layout settings persisted per user. */
export interface GrassSettings {
  userId: string;
  /** Legacy single-layout width (pre-vertical-drag). Still read as a
   *  fallback for inline values when per-mode fields are absent; new
   *  writes populate inlineWidth/belowWidth instead. */
  width?: number;
  /** Legacy single-layout xOffset. Same fallback role as `width`. */
  xOffset?: number;
  /** Per-layout-mode persistence so horizontal resize/offset is
   *  preserved across inline↔below switches. `null` means "not yet set
   *  for this mode" — applyConstraints falls through to natural width. */
  inlineWidth?: number | null;
  inlineXOffset?: number | null;
  belowWidth?: number | null;
  belowXOffset?: number | null;
  layoutMode?: 'inline' | 'below';
  updated_at: string;
}

/** Distribution chart item (character, copyright, hair, breasts, etc.). */
export interface DistributionItem {
  name: string;
  tagName?: string;
  originalTag?: string;
  /**
   * Accurate per-user (or per-fav) count from `/counts/posts.json`.
   * Source of truth for top-10 *selection* (`selectTopKByCount` in
   * `src/core/related-tag-rerank.ts`) and for sub-tag breakdown rows.
   * Do not substitute `frequency` here — `frequency` is sample-based
   * and was the v9.6.1 source of madoka/sensei swap + Unbreakable
   * top-10 leakage that v9.6.2 fixed.
   */
  count: number;
  /**
   * Danbooru `/related_tag.json` sample-estimated frequency (up to
   * 5,000 md5-ordered posts). Used as the 1st-pass candidate ordering
   * before count-rerank in `selectTopKByCount`. Do not use for final
   * *selection* or display — the sample SE on close pairs can flip
   * ranks (madoka/sensei class).
   */
  frequency: number;
  thumb: string | null;
  isOther: boolean;
  color?: string;
  /**
   * Sub-tag breakdown for legend hover/tap (v9.6.0+). Populated for Copy /
   * Fav_Copy / Char distributions when the top-level tag has implications
   * (sub-tags) that the user actually uses. Empty/undefined = no tooltip.
   * Entry counts come from `/counts/posts.json` via `attachSubTagBreakdowns`.
   */
  subTags?: SubTagBreakdownEntry[];
}

/** Single row in a sub-tag breakdown (DistributionItem.subTags). */
export interface SubTagBreakdownEntry {
  tagName: string;
  count: number;
  /** 0..1 — share of the parent's sub-tag user-count sum. */
  share: number;
  /** True for the trailing "Others" bucket; not clickable in UI. */
  isOther: boolean;
}

/** Sync progress state for AnalyticsDataManager. */
export interface SyncProgress {
  current: number;
  total: number;
  message: string;
}

/** CalHeatmap datum bound to SVG rect elements. */
export interface CalHeatmapDatum {
  /** Unix timestamp in milliseconds. */
  t: number;
  /** Contribution count (null if no data). */
  v: number | null;
}

/** Scatter plot data point. */
export interface ScatterDataPoint {
  id: number;
  /** Date timestamp. */
  d: number;
  /** Score. */
  s: number;
  /** General tag count. */
  t: number;
  /** Rating (g/s/q/e). */
  r: string;
  /** Down score (negative integer; undefined if not yet backfilled). */
  dn?: number;
  /** True if post is deleted. Undefined if not yet backfilled. */
  del?: boolean;
  /** True if post is banned. Undefined if not yet backfilled. */
  ban?: boolean;
}

/** Daily count record for uploads/approvals/notes tables. */
export interface DailyCountRecord {
  /** Composite key: `${userId}_${date}`. */
  id: string;
  userId: string;
  date: string;
  count: number;
}

/** Completed year cache record. */
export interface CompletedYearRecord {
  id: string;
  userId: string;
  metric: string;
  year: number;
}

/** Approval detail record. */
export interface ApprovalDetailRecord {
  /** Composite key: `${userId}_${date}`. */
  id: string;
  userId: string;
  /** Ordered list of post IDs approved on this date. */
  post_list?: number[];
}

/** Hourly stats cache record. */
export interface HourlyStatRecord {
  id: string;
  userId: string;
  metric: string;
  year: number;
}

/** Full post record stored in the `posts` IndexedDB table. */
export interface PostRecord {
  id: number;
  uploader_id: number;
  /** User-scoped sequence number (1-based, per uploader_id). */
  no: number;
  created_at: string;
  /** Total score (up_score + down_score; down_score is negative). */
  score: number;
  /** Up score (non-negative integer); undefined until metadata backfill. */
  up_score?: number;
  /** Down score (negative integer); undefined until metadata backfill. */
  down_score?: number;
  /** Whether the post has been deleted. Undefined until metadata backfill. */
  is_deleted?: boolean;
  /** Whether the post has been banned. Undefined until metadata backfill. */
  is_banned?: boolean;
  rating: string;
  tag_count_general: number;
  approver_id?: number;
  uploader_name?: string;
  uploader_level?: string;
  approver_name?: string;
  approver_level?: string;
  variants?: PostVariant[];
  preview_file_url?: string;
  file_url?: string;
  tag_string_copyright?: string;
  tag_string_character?: string;
}

/** User-level aggregate statistics stored in the `user_stats` table. */
export interface UserStatsRecord {
  /** User ID (string form to match other user-keyed tables). */
  userId: string;
  /** Count of posts where general tag count is below 10. */
  gentags_lt_10: number;
  /** Count of posts where total tag count is below 10. */
  tagcount_lt_10: number;
  /** Last refresh timestamp (ms since epoch). */
  updated_at: number;
}

/** Cached pie chart statistics record in the `piestats` table. */
export interface PieStatRecord {
  key: string;
  userId: string | number;
  data: unknown;
  updated_at: string;
}

/** Monthly post count history entry. */
export interface HistoryEntry {
  /** Date string in YYYY-MM-DD format (always first of month). */
  date: string;
  count: number;
  cumulative: number;
}

/** User ranking entry for tag analytics leaderboards. */
export interface UserRanking {
  id: string | number;
  count: number;
  rank?: number;
  name?: string;
  level?: string | null;
}

/** Milestone post entry. */
export interface MilestoneEntry {
  /** Milestone target number (e.g. 1, 100, 1000). */
  milestone: number;
  /** Display label (e.g. "First", "1 k") — set by getMilestones, absent in tag milestones. */
  type?: string;
  post: {
    id: number;
    created_at: string;
    uploader_id: number;
    uploader_name?: string;
    uploader_level?: string;
    approver_id?: number;
    approver_name?: string;
    rating: string;
    score?: number;
    variants?: PostVariant[];
    preview_file_url?: string;
    file_url?: string;
  };
}

/** A single tag cloud entry with name and frequency. */
export interface TagCloudItem {
  /** Display name (underscores replaced with spaces). */
  name: string;
  /** Raw tag name for URL construction. */
  tagName: string;
  /** Co-occurrence frequency (0..1) from related_tag API. */
  frequency: number;
  /** Estimated post count (frequency × total query posts). */
  count: number;
}

/** A tag created by a user, parsed from NNTBot forum reports. */
export interface CreatedTagItem {
  /** Raw tag name (underscore format). */
  tagName: string;
  /** Display name (underscores replaced with spaces). */
  displayName: string;
  /** Current post count on Danbooru. */
  postCount: number;
  /** Whether the tag is deprecated. */
  isDeprecated: boolean;
  /** Alias target tag name, or null if not aliased. */
  aliasedTo: string | null;
  /** Date when the tag first appeared in the NNTBot report (YYYY-MM-DD). */
  reportDate: string;
}

// =========================================================================
// Danbooru API Response Types
//
// Minimal-but-sufficient interfaces for the Danbooru REST API responses
// consumed by this project. See `.claude/rules/api-endpoints.md` for the
// endpoint catalog. Field optionality reflects two realities:
//   1. Most fetches use `only=...` to request a subset of fields, so even
//      "obvious" fields are absent from the response object.
//   2. Some fields (e.g. `uploader_name`, `up_score`) are introduced by
//      newer Danbooru schema versions or backfilled by this project's own
//      code after the initial fetch.
// Use `unknown` for genuinely opaque blobs; do not speculate fields.
// =========================================================================

/**
 * Post object from `/posts.json`, `/posts/{id}.json`, `/posts/random.json`.
 *
 * Only `id`, `created_at`, `uploader_id`, and `rating` are universally
 * present — every other field depends on the request's `only=` parameter or
 * the post's age (e.g. `up_score`/`down_score` were added later).
 *
 * The trailing `uploader_name` / `uploader_level` / `approver_name` /
 * `approver_level` fields are NOT from the Danbooru API. They are filled
 * in-place by `TagAnalyticsDataService.backfillUploaderNames()` after a
 * separate `/users.json` fetch — they live here so the same response
 * objects can be passed around without re-typing.
 */
export interface DanbooruPost {
  id: number;
  created_at: string;
  uploader_id: number;
  rating: string;

  // Score & engagement
  score?: number;
  up_score?: number;
  down_score?: number;
  fav_count?: number;
  tag_count_general?: number;

  // Status flags (modern post schema)
  is_deleted?: boolean;
  is_banned?: boolean;
  is_pending?: boolean;
  is_flagged?: boolean;

  // Approval
  approver_id?: number;

  // Tag strings (only included when requested via `only=`)
  tag_string_artist?: string;
  tag_string_copyright?: string;
  tag_string_character?: string;

  // Media (variants is the modern field; *_file_url are legacy fallbacks)
  variants?: PostVariant[];
  preview_file_url?: string;
  file_url?: string;
  large_file_url?: string;

  // Backfilled by this project AFTER fetching (not from the API)
  uploader_name?: string;
  uploader_level?: string;
  approver_name?: string;
  approver_level?: string;
}

/* ----- Dashboard preview popover (feature view-models) ----- */

/**
 * Post status driving the preview popover's thumbnail border colour.
 * `appealed` is a deleted post with a pending appeal — resolved via a
 * separate `status:appealed` id query, not a per-post API flag.
 */
export type PostPreviewStatus =
  | 'active'
  | 'pending'
  | 'appealed'
  | 'flagged'
  | 'deleted';

/** One thumbnail cell in the preview popover's recent-posts grid. */
export interface PostPreview {
  id: number;
  /** 180x180 variant URL (falls back to best-available, then ''). */
  thumbUrl: string;
  score: number;
  /** General tag count (`tag_count_general`); undefined when the API omits it. */
  generalTags?: number;
  /**
   * Tags the *uploader* added on the post's first version (`added_tags` length,
   * which merges the uploader's own ~1h follow-up edits). Drives the
   * "mintagged" (under-tagged by the uploader) orange label. Undefined when the
   * post_versions lookup missed — left unflagged (fail-open).
   */
  uploaderTagCount?: number;
  /** Danbooru rating letter ('g' | 's' | 'q' | 'e'); '' when the API omits it. */
  rating: string;
  status: PostPreviewStatus;
}

/** Activity feed types shown in the preview popover's distribution strip. */
export type ActivityType =
  | 'upload' // post_versions is_new=true (the upload itself)
  | 'edit' // post_versions is_new=false (later tag/metadata edits)
  | 'note'
  | 'wiki'
  | 'artist'
  | 'commentary'
  | 'pool'
  | 'forum'
  | 'approval'
  | 'comment'
  | 'appeal'
  // cross-cutting: a malicious-looking upload/comment (section B). Named
  // 'suspicious' (not 'flagged') to avoid clashing with Danbooru's
  // status:flagged / the is_flagged PostPreviewStatus used in section A.
  | 'suspicious';

/** One activity occurrence: a type plus its timestamp (ms since epoch). */
export interface ActivitySegment {
  type: ActivityType;
  /** Epoch milliseconds (parsed from updated_at/created_at). */
  ts: number;
  /**
   * The Danbooru post this segment points at, set only for `suspicious`
   * segments: a suspicious upload's own post, or the post a suspicious
   * comment is attached to. Used to build the legend's `id:` link-out.
   */
  postId?: number;
  /**
   * Id used to anchor (`#`-scroll) this segment's row on its type's index
   * page: the post id for `upload` (gallery `#post_<id>`), else the native
   * record id (post_version, note_version, comment, …). The oldest in-window
   * value per type becomes the legend link's scroll target.
   */
  anchorId?: number;
}

/** Merged recent-activity result for the distribution strip. */
export interface ActivityDistribution {
  /** Most-recent-first, capped at the requested limit (e.g. 100). */
  recent: ActivitySegment[];
  /** Per-type tally within `recent` (all types present, zero-filled). */
  counts: Record<ActivityType, number>;
  /**
   * Deduped post ids of the `suspicious` segments in `recent` (uploads' own
   * posts + the posts suspicious comments sit on). Drives the legend's
   * "open the exact flagged posts" `id:` link; empty when none resolved.
   */
  suspiciousPostIds: number[];
  /**
   * Per type, the `anchorId` of the *oldest* in-window segment — the legend
   * link appends `#<prefix>_<id>` so the page scrolls to that boundary item.
   * Absent for types with no resolvable id. `suspicious` is excluded (its
   * anchor comes from {@link suspiciousPostIds}).
   */
  oldestAnchorByType: Partial<Record<ActivityType, number>>;
}

/**
 * User object from `/users.json`.
 * The project always requests `only=id,name,level_string` so other fields
 * are normally absent. `created_at` is included only on a few endpoints
 * that fetch the full user record.
 */
export interface DanbooruUser {
  id: number;
  name: string;
  level_string: string;
  created_at?: string;
}

/**
 * Tag object from `/tags.json`.
 * Category codes: 0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta.
 */
export interface DanbooruTag {
  id?: number;
  name: string;
  post_count: number;
  created_at: string;
  category: number;
}

/**
 * One entry from `/related_tag.json`'s `related_tags` array.
 *
 * Two response shapes coexist in the wild: some entries put `frequency`
 * directly on the item, others nest it inside a sub-object also called
 * `related_tag` (yes, the naming is confusing). Consumer code handles both
 * via `item.related_tag?.frequency ?? item.frequency`.
 */
export interface DanbooruRelatedTag {
  tag: {
    name: string;
    post_count?: number;
    category?: number;
  };
  frequency: number;
  related_tag?: {
    frequency: number;
  };
}

/** Top-level response from `/related_tag.json`. */
export interface DanbooruRelatedTagResponse {
  query?: string;
  /** Total post count for the query (e.g. `user:foo`); used to scale frequency → count. */
  post_count?: number;
  related_tags: DanbooruRelatedTag[];
}

/**
 * Tag implication entry from `/tag_implications.json`.
 * Used by `isTopLevelTag()` — if any implication exists for a tag, it is
 * NOT considered top-level.
 */
export interface DanbooruTagImplication {
  id: number;
  antecedent_name: string;
  consequent_name: string;
  status?: string;
}

/**
 * User feedback entry from `/user_feedbacks.json`.
 * Body text is parsed for promotion/demotion history (see
 * `getPromotionHistory` / `getLevelChangeHistory`).
 */
export interface DanbooruUserFeedback {
  id?: number;
  user_id?: number;
  created_at: string;
  body: string;
  category?: string;
}

// =========================================================================
// End of Danbooru API Response Types
// =========================================================================

/** Cached tag analytics report stored in the `tag_analytics` table. */
export interface TagAnalyticsReport {
  tagName: string;
  updatedAt: number;
  data: TagAnalyticsMeta;
  /**
   * Timestamp (ms) of the last full monthly-count scan. Used by the 90-day
   * forced rescan policy in `fetchMonthlyCounts` to recover from slow
   * erosion that the 2% drift guard misses (rare individual post deletions
   * accumulating over time). Absent on pre-v12 records.
   */
  lastFullScanAt?: number;
  /**
   * Timestamp (ms) of the last refresh of the count-only deferred overlays
   * (statusCounts + ratingCounts). Decoupled from `updatedAt` because
   * `_checkCache` bumps `updatedAt` on every cache hit when refreshing
   * volatile post fields, but the count overlays only refresh when the
   * v9.6 count-cache TTL elapses. Absent on pre-v9.6 records.
   */
  countsUpdatedAt?: number;
}

/**
 * Monthly post count cache entry stored in the `tag_monthly_counts` table.
 * Key: `[tag+yearMonth]`. Distance-based TTL applied at read time:
 *   - current + last month: always stale (forced refetch, matches Delta sync)
 *   - 2–12 months old: 7 days
 *   - 13–36 months old: 30 days
 *   - 37+ months old: 180 days
 */
export interface MonthlyCountRecord {
  tag: string;
  /** `YYYY-MM`. */
  yearMonth: string;
  count: number;
  /** Fetch timestamp in ms since epoch. */
  fetchedAt: number;
}

/**
 * Cached result of `isTopLevelTag` (tag_implications lookup) stored in the
 * `tag_implications_cache` table. Global cache — not tied to the current
 * analytics target tag. `tag_implications` is effectively immutable, so a
 * 180-day TTL is applied at read time.
 */
export interface TagImplicationCacheRecord {
  /**
   * Two key shapes coexist in this table:
   *  - `<tagName>` — antecedent-keyed (`isTopLevelTag` lookup, populated
   *    by `fetchTopLevelTagsBatch`). The meaningful field is `isTopLevel`.
   *  - `consequent:<parent>` — consequent-keyed (sub-tag breakdown,
   *    populated by `fetchSubTagsForParents`, v9.6.0+). The meaningful
   *    field is `subs`; `isTopLevel` is a `false` placeholder ignored on
   *    read because callers query the two shapes by distinct key
   *    prefixes (no cross-contamination).
   */
  tagName: string;
  isTopLevel: boolean;
  /** Present for consequent-keyed rows — list of sub-tag candidate names. */
  subs?: string[];
  /** Fetch timestamp in ms since epoch. */
  fetchedAt: number;
  /**
   * Embedded schema version stamped at write time. Read sites compare
   * against `IMPLICATIONS_CACHE_SCHEMA_VERSION` to detect contract drift
   * (e.g. the URL changing between releases) without a Dexie version bump.
   * Optional in the type because pre-v9.6 records on existing clones lack
   * the field; absence is treated as a mismatch and forces a re-fetch.
   */
  schemaVersion?: number;
}

/**
 * Result of a post sync. A worker that exhausts its retries stops quietly and
 * leaves the DB prefix-consistent, so the run resolves normally even though it
 * did not cover every page — this carries that distinction out to the caller,
 * which decides whether to report success or warn (audit M-2).
 */
export interface SyncOutcome {
  /** True only when every page was fetched and committed. */
  complete: boolean;
  /**
   * False when the run never began — no user id, or another sync already
   * holds the global lock. Nothing was fetched and nothing changed, which is
   * a different thing from "fetched part of it": there is no partial data to
   * warn about and no reason to force a post-paint revalidate. Callers must
   * check this before treating `complete: false` as an incomplete *fetch*.
   */
  started: boolean;
}

/** Complete tag analytics metadata. */
export interface TagAnalyticsMeta {
  name: string;
  /** Category ID: 1=Artist, 3=Copyright, 4=Character. */
  category: number;
  post_count: number;
  created_at: string;
  updatedAt: number;
  /**
   * v9.6: timestamp (ms) of the last refresh of count-only overlays
   * (statusCounts + ratingCounts). Surfaced from the cache record so the
   * app layer can compare against the user-configured count-cache TTL
   * and decide whether to re-run the deferred counts on cache hit.
   */
  countsUpdatedAt?: number;
  _isCached?: boolean;
  firstPost?: DanbooruPost;
  hundredthPost?: DanbooruPost;
  timeToHundred?: number;
  historyData: HistoryEntry[];
  precalculatedMilestones: MilestoneEntry[];
  rankings: {
    uploader: {
      allTime: UserRanking[];
      year: UserRanking[];
      first100: UserRanking[];
    };
    approver: {
      allTime: UserRanking[];
      year: UserRanking[];
      first100: UserRanking[];
    };
  };
  statusCounts: Record<string, number>;
  ratingCounts: Record<string, number>;
  commentaryCounts?: Record<string, number>;
  translationCounts?: Record<string, number>;
  copyrightCounts?: Record<string, number>;
  characterCounts?: Record<string, number>;
  latestPost?: DanbooruPost;
  trendingPost?: DanbooruPost;
  trendingPostNSFW?: DanbooruPost;
  newPostCount?: number;
}
