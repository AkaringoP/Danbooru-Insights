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

/** Threshold values for each contribution metric. */
export interface ThresholdMap {
  uploads: number[];
  approvals: number[];
  notes: number[];
}

/** Persisted user settings stored in localStorage. */
export interface SettingsData {
  theme: string;
  thresholds: ThresholdMap;
  /** Maps userId → last used metric mode. */
  rememberedModes: Record<string, string>;
  /** Max post-count diff allowed before triggering an automatic sync. */
  syncThreshold?: number;
  /** Per-theme grass palette index (themeKey → 0-3). */
  grassIndexByTheme?: Record<string, number>;
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
  width?: number;
  xOffset?: number;
  updated_at: string;
}

/** Distribution chart item (character, copyright, hair, breasts, etc.). */
export interface DistributionItem {
  name: string;
  tagName?: string;
  originalTag?: string;
  count: number;
  frequency: number;
  thumb: string | null;
  isOther: boolean;
  color?: string;
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

/** Danbooru rating code. */
export type Rating = 'g' | 's' | 'q' | 'e';

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
  id: number;
  userId: string;
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
  milestone: number;
  post: {
    id: number;
    created_at: string;
    uploader_id: number;
    uploader_name?: string;
    uploader_level?: string;
    approver_id?: number;
    approver_name?: string;
    rating: string;
    score: number;
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
 * Response from `/counts/posts.json`.
 *
 * Two shapes coexist: modern responses wrap counts in a `counts` object,
 * legacy responses use a flat `posts` field. Consumers always use the
 * `data.counts?.posts ?? data.posts ?? 0` fallback chain.
 */
export interface DanbooruCountResponse {
  counts?: {
    posts: number;
  };
  posts?: number;
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

/** Approval entry from `/post_approvals.json`. */
export interface DanbooruApproval {
  id: number;
  post_id: number;
  user_id: number;
  created_at: string;
}

/** Note version entry from `/note_versions.json`. */
export interface DanbooruNoteVersion {
  id?: number;
  updater_id: number;
  created_at: string;
}

// =========================================================================
// End of Danbooru API Response Types
// =========================================================================

/** Cached tag analytics report stored in the `tag_analytics` table. */
export interface TagAnalyticsReport {
  tagName: string;
  updatedAt: number;
  data: TagAnalyticsMeta;
}

/** Complete tag analytics metadata. */
export interface TagAnalyticsMeta {
  name: string;
  /** Category ID: 1=Artist, 3=Copyright, 4=Character. */
  category: number;
  post_count: number;
  created_at: string;
  updatedAt: number;
  _isCached?: boolean;
  firstPost?: PostRecord;
  hundredthPost?: PostRecord;
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
  copyrightCounts?: Record<string, number>;
  characterCounts?: Record<string, number>;
  latestPost?: PostRecord;
  trendingPost?: PostRecord;
  trendingPostNSFW?: PostRecord;
  newPostCount?: number;
}
