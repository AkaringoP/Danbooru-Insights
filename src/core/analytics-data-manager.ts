import {CountUnavailableError, DataManager} from './data-manager';
import {
  afterCatchUpPage,
  startCatchUp,
  type CatchUpCursor,
  type CatchUpStep,
} from './change-catch-up';
import {
  createLocalDistributionCounter,
  type LocalDistributions,
} from './local-distributions';
import {
  POST_FIELDS_VERSION,
  SYNC_POST_FIELDS,
  toPostRecord,
} from './post-record';
import {fitsViewerTagLimit} from './search-terms';
import {
  patchSyncMeta,
  readSyncMeta,
  responseServerTime,
  viewerTimeZone,
} from './sync-meta';
import type {ApiItem} from './data-manager';
import type {Database} from './database';
import type {RateLimitedFetch} from './rate-limiter';
import {perfLogger} from './perf-logger';
import {createLogger} from './logger';
import {
  bulkPutSafe,
  evictOldestNonCurrentUser,
  requestPersistence,
} from './quota-manager';
import {getCountCacheTtlMs} from './settings';
import {
  applyGeneralTagCloudFilter,
  getGlobalTopGeneralTags,
  getGlobalTotalPosts,
  LIFT_THRESHOLD,
  USER_COUNT_FLOOR,
  type TagCloudFilterEntry,
} from './global-tag-stats';
import {applySubTagBreakdown, fetchSubTagsForParents} from './sub-tag-resolver';
import {
  charPoolSize,
  copyPoolSize,
  selectTopKByCount,
} from './related-tag-rerank';
import {
  buildMintagVersionsUrl,
  buildPostVersionsUrl,
  buildPreviewPostUrls,
  buildUploaderTagCounts,
  classifyCommentType,
  classifyUploadType,
  filterUploadCoupledCommentary,
  isAbandonedByGap,
  mergeRecentActivity,
  toPostPreview,
} from './dashboard-preview';
import type {CommentarySegment, UploadMeta} from './dashboard-preview';
import {
  WINDOW_SIZE,
  buildRecentWindowUrl,
  danbooruPostToWindowPoint,
} from './profile-summary';
import {CONFIG} from '../config';

const log = createLogger('Analytics');
const workerLog = createLogger('Analytics:Worker');

/**
 * How long `getTotalPostCount` reuses an in-flight/just-resolved lookup.
 * Sized to span one report click's fan-out (pre-check → sync → header →
 * distributions), not to act as a cache — see getTotalPostCount.
 */
const TOTAL_COUNT_MEMO_MS = 30_000;

/**
 * Identity used to match a distribution row across refreshes. Which field
 * carries the tag depends on the distribution: character/copyright/breasts
 * fill `tagName`, the hair ones fill `originalTag`, and the rest only have a
 * display `name`. Empty string means "no usable identity".
 */
function distributionItemKey(item: DistributionItem): string {
  return item.tagName || item.originalTag || item.name || '';
}
import {getBestThumbnailUrl} from '../utils';
import {getTopLevelFlags, pruneImplicationCache} from './top-level-tags';
import type {
  TargetUser,
  DistributionItem,
  SyncMetaRecord,
  SyncProgress,
  ScatterDataPoint,
  TagCloudItem,
  CreatedTagItem,
  UserStatsRecord,
  PostRecord,
  DanbooruPost,
  DanbooruRelatedTag,
  DanbooruUserFeedback,
  PostPreview,
  ActivityType,
  ActivitySegment,
  ActivityDistribution,
  SyncOutcome,
  WindowPoint,
} from '../types';

/**
 * One activity-feed descriptor for
 * {@link AnalyticsDataManager.getActivityDistribution}: the endpoint and the
 * user search param, plus an optional extra search clause (e.g. `is_new`).
 */
interface ActivityDescriptor {
  type: ActivityType;
  endpoint: string;
  param: string;
  extra?: string;
}

/** Summary statistics for a user's upload history. */
export interface SummaryStats {
  maxUploads: number;
  maxDate: string;
  firstUploadDate: Date | null;
  lastUploadDate: Date | null;
  count1Year: number;
  maxUploads1Year: number;
  maxDate1Year: string;
  maxStreak: number;
  maxStreakStart: string | null;
  maxStreakEnd: string | null;
  activeDays: number;
}

/** A milestone post entry. */
export interface MilestoneEntry {
  type: string;
  post: PostRecord;
  milestone: number;
}

/** Monthly upload count entry. */
export interface MonthlyStatEntry {
  date: string;
  count: number;
  label: string;
}

/** A user promotion event parsed from feedbacks. */
export interface PromotionEvent {
  date: Date;
  role: string;
  rawBody: string;
}

/** A user level change event parsed from mod_actions. */
export interface LevelChangeEvent {
  date: Date;
  fromLevel: string;
  toLevel: string;
  isPromotion: boolean;
}

/** A lightweight milestone entry for the timeline (date only, no thumbnail). */
export interface TimelineMilestone {
  index: number;
  date: Date;
}

/**
 * Input counts for Untagged translation inclusion-exclusion formula.
 * See PLAN.md §9 for derivation and TC-A~E in test/translation-distribution.test.ts.
 */
export interface UntaggedTranslationCounts {
  /** |user:X *_text| — all posts with any _text tag */
  t: number;
  /** |user:X english_text| = |T ∩ E| (english_text ⊆ T) */
  a: number;
  /** |user:X *_text translation_request| = |T ∩ R| */
  b: number;
  /** |user:X *_text translated| = |T ∩ TR| */
  c: number;
  /** |user:X english_text translation_request| = |T ∩ E ∩ R| */
  ab: number;
  /** |user:X english_text translated| = |T ∩ E ∩ TR| */
  ac: number;
}

/**
 * Computes Untagged translation count via inclusion-exclusion:
 *   Untagged = max(0, t − a − b − c + ab + ac)
 *
 * Assumption (Assumption-1): |R ∩ TR| ≈ 0 (translation_request and translated
 * are mutually exclusive states). Necessary because |T ∩ R ∩ TR| requires a
 * 3-tag query which exceeds the Member(Blue) 2-tag limit.
 *
 * See PLAN.md §9 for full derivation.
 */
export function computeUntaggedTranslation(
  counts: UntaggedTranslationCounts,
): number {
  const {t, a, b, c, ab, ac} = counts;
  return Math.max(0, t - a - b - c + ab + ac);
}

/**
 * A pie slice whose search is over the viewer's tag limit (T-408): not
 * asked, shown locked, and — like any unknown count — given no share.
 */
function markLocked(slice: DistributionItem): void {
  slice.unknown = true;
  slice.locked = true;
}

/**
 * The three counts behind the commentary pie's "Untagged" (T-408, decision
 * G-5): posts with commentary, and those of them tagged `commentary` or
 * `commentary_request`. Untagged ≈ total − both, assuming the two tags
 * rarely meet on a post (Translation's Untagged assumes the same). Up to 3
 * search terms: a Member can run them all, an anonymous viewer the first
 * only. The old single query (`has:commentary -commentary
 * -commentary_request`) was 4 terms, over every limit below Gold.
 */
function buildUntaggedCommentaryQueries(prefix: string): {
  total: string;
  commentary: string;
  request: string;
} {
  return {
    total: `${prefix} has:commentary`,
    commentary: `${prefix} has:commentary commentary`,
    request: `${prefix} has:commentary commentary_request`,
  };
}

/** Untagged commentary from {@link buildUntaggedCommentaryQueries}'s counts. */
function computeUntaggedCommentary(counts: {
  total: number;
  commentary: number;
  request: number;
}): number {
  return Math.max(0, counts.total - counts.commentary - counts.request);
}

/**
 * Builds the 6 subqueries for Untagged inclusion-exclusion calculation plus the
 * BC intersection query used for Assumption-1 runtime monitoring. With the
 * `user:X` prefix they cost up to 3 search terms (`user:` and the `*_text`
 * wildcard count): fine for a Member (3), a 422 for an anonymous viewer (2).
 *
 * `prefix` is prepended to every subquery — `user:X` for user-side translation
 * distribution, a single tag name (e.g. `sword`) for tag-side. Pass it
 * already-normalized (spaces → underscores, no trailing whitespace).
 */
export function buildUntaggedTranslationQueries(prefix: string): {
  t: string;
  a: string;
  b: string;
  c: string;
  ab: string;
  ac: string;
  bc: string;
} {
  return {
    t: `${prefix} *_text`,
    a: `${prefix} english_text`,
    b: `${prefix} *_text translation_request`,
    c: `${prefix} *_text translated`,
    ab: `${prefix} english_text translation_request`,
    ac: `${prefix} english_text translated`,
    bc: `${prefix} translation_request translated`,
  };
}

// ============================================================
// Backfill failure tracking (Task 4 — backfill error recovery)
// ============================================================

/**
 * Persisted failure state for `backfillPostMetadata`. Stored in localStorage
 * under {@link backfillFailureStorageKey} so the cooldown survives page
 * reloads — without persistence, every dashboard open would retry a
 * persistently-failing backfill, hammering the API in an infinite loop.
 */
export interface BackfillFailureState {
  /** Unix ms of the most recent failed attempt. */
  lastAttemptAt: number;
  /** Number of consecutive failures since the last success. */
  failureCount: number;
}

/** After this many consecutive failures, the user enters cooldown. */
export const BACKFILL_FAILURE_THRESHOLD = 3;

/** Cooldown duration. After this, one retry is allowed. */
export const BACKFILL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** localStorage key for a user's persisted failure state. */
export function backfillFailureStorageKey(uploaderId: number): string {
  return `di_backfill_failure_${uploaderId}`;
}

/**
 * Pure cooldown decision. Returns true if the user has hit the failure
 * threshold AND the last attempt is still within the cooldown window.
 *
 * Exported as a standalone function (not a class method) so unit tests can
 * exercise the threshold/cooldown logic without instantiating the full
 * AnalyticsDataManager (Dexie + RateLimiter).
 */
export function isBackfillInCooldown(
  state: BackfillFailureState | null,
  now: number = Date.now(),
): boolean {
  if (!state) return false;
  return (
    state.failureCount >= BACKFILL_FAILURE_THRESHOLD &&
    now - state.lastAttemptAt < BACKFILL_COOLDOWN_MS
  );
}

/**
 * Pure increment. Returns the next failure state after recording one more
 * failure. Does not touch localStorage.
 */
export function recordFailure(
  prev: BackfillFailureState | null,
  now: number = Date.now(),
): BackfillFailureState {
  return {
    lastAttemptAt: now,
    failureCount: (prev?.failureCount ?? 0) + 1,
  };
}

/**
 * Whether an HTTP status code should count as a hard failure for cooldown
 * purposes. 429 is excluded because the rate-limiter already triggers a
 * global backoff for it — counting 429 as a failure would double-penalize
 * the user (rate-limiter cooldown + our cooldown), and the rate-limiter
 * cooldown is the right place to handle it.
 */
export function shouldCountHttpAsFailure(status: number): boolean {
  return status !== 429;
}

/**
 * Whether the stale-data cleanup may delete another user's rows (T-404):
 * their last completed sync is missing or older than `threshold`, and no
 * sync of theirs started within it. A first sync that failed leaves no
 * completion stamp; without the started mark, the next cleanup (at the end
 * of any other user's sync) deleted what it had committed.
 */
export function isStaleUser(
  lastSyncAt: number | null,
  syncStartedAt: number | undefined,
  now: number,
  threshold: number,
): boolean {
  if (syncStartedAt !== undefined && now - syncStartedAt <= threshold) {
    return false;
  }
  if (lastSyncAt === null || Number.isNaN(lastSyncAt)) return true;
  return now - lastSyncAt > threshold;
}

/**
 * How long one scan's local distributions serve a dashboard load's pies
 * (T-406): the five callers run together, and a sync or backfill drops it.
 */
const LOCAL_DISTRIBUTIONS_MEMO_MS = 10_000;

/**
 * How long one scan of a user's rows serves the dashboard (T-501). An open
 * reads it for the summary, the scatter, the monthly chart and the local
 * pies within seconds; the limit bounds how long a write from elsewhere
 * (another tab's sync) could go unseen, and how long the memory is held.
 */
const ROW_SNAPSHOT_MEMO_MS = 60_000;

/** What the dashboard needs from one pass over a user's rows (T-501). */
interface RowSnapshot {
  /** One scatter point per row with a `created_at`, in the index's order. */
  points: ScatterDataPoint[];
  /**
   * Each point's `created_at` date part as stored (`YYYY-MM-DD`, in the
   * viewer's time zone at the sync), the summary's and monthly chart's key.
   */
  days: string[];
  /** Every row counted for the local pies; used only when they qualify. */
  local: LocalDistributions;
}

/**
 * Uploads per day key, all time and since `oneYearAgo`, with the first and
 * last upload — the summary's pass over a {@link RowSnapshot}.
 */
function tallyUploadDays(
  points: ScatterDataPoint[],
  days: string[],
  oneYearAgo: Date,
): {
  historyAll: Record<string, number>;
  history1Year: Record<string, number>;
  first: Date | null;
  last: Date | null;
  count1Year: number;
} {
  const historyAll: Record<string, number> = {};
  const history1Year: Record<string, number> = {};
  let first: Date | null = null;
  let last: Date | null = null;
  let count1Year = 0;
  for (let i = 0; i < points.length; i++) {
    const day = days[i];
    historyAll[day] = (historyAll[day] || 0) + 1;
    const d = new Date(points[i].d);
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
    if (d >= oneYearAgo) {
      history1Year[day] = (history1Year[day] || 0) + 1;
      count1Year++;
    }
  }
  return {historyAll, history1Year, first, last, count1Year};
}

/** The day with the most uploads; on a tie, the first one met. */
function busiestDay(history: Record<string, number>): {
  count: number;
  date: string;
} {
  let count = 0;
  let date = 'N/A';
  for (const [day, n] of Object.entries(history)) {
    if (n > count) {
      count = n;
      date = day;
    }
  }
  return {count, date};
}

/** The longest run of consecutive days among sorted `YYYY-MM-DD` keys. */
function longestStreak(sortedDates: string[]): {
  length: number;
  start: string | null;
  end: string | null;
} {
  let best = {
    length: 0,
    start: null as string | null,
    end: null as string | null,
  };
  let current = 0;
  let currentStart: string | null = null;
  let previous: Date | null = null;
  for (const dateStr of sortedDates) {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    if (!previous) {
      current = 1;
      currentStart = dateStr;
    } else {
      const diffDays = Math.round(
        (d.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays === 1) {
        current++;
      } else if (diffDays > 1) {
        current = 1;
        currentStart = dateStr;
      }
    }
    if (current > best.length) {
      best = {length: current, start: currentStart, end: dateStr};
    }
    previous = d;
  }
  return best;
}

/** Tags checked per top-level lookup on the local tag pies (T-406). */
const LOCAL_TOP_LEVEL_BATCH = 50;

/**
 * The most tags the local tag pies check for ten top-level ones: a few
 * lookups (cached 180 days), not one per tag of a dispersed account.
 */
const LOCAL_TOP_LEVEL_SCAN_LIMIT = 200;

/** Posts per `order:change` page of the change catch-up (T-407). */
const CATCH_UP_PAGE_LIMIT = 200;

/**
 * The watermark a change catch-up starts from, or null when it should not
 * run now (T-407): rows below fields version 2 or without a watermark, a
 * sync under way or failed, a walk already past the page limit, or one
 * completed within `ttlMs`.
 */
export function catchUpWatermark(
  meta: SyncMetaRecord | undefined,
  now: number,
  ttlMs: number,
): number | null {
  if (!meta || meta.changeWatermark === undefined) return null;
  if ((meta.fieldsVersion ?? 0) < POST_FIELDS_VERSION) return null;
  if (meta.syncStartedAt !== undefined || meta.needsFullSync) return null;
  if (meta.caughtUpAt !== undefined && now - meta.caughtUpAt < ttlMs) {
    return null;
  }
  return meta.changeWatermark;
}

/** Id ranges a fields backfill walks in parallel (T-403). */
const BACKFILL_RANGES = 3;

/**
 * Splits sorted ids into up to `parts` contiguous ranges of about the same
 * number of ids, as `{after, to}`: a range holds the ids in (after, to].
 * The first starts just below the smallest id.
 */
export function splitIdRanges(
  sortedIds: number[],
  parts: number,
): Array<{after: number; to: number}> {
  const n = sortedIds.length;
  if (n === 0) return [];
  const k = Math.max(1, Math.min(parts, n));
  const ranges: Array<{after: number; to: number}> = [];
  let after = sortedIds[0] - 1;
  for (let i = 1; i <= k; i++) {
    const to = sortedIds[Math.ceil((n * i) / k) - 1];
    if (to > after) {
      ranges.push({after, to});
      after = to;
    }
  }
  return ranges;
}

/** One run of the fields backfill, shared by its parallel ranges. */
interface BackfillRun {
  /** Server time of the first response (the watermark), once known. */
  from: number | undefined;
  /** The plan, with each range's progress; saved after every page. */
  ranges: Array<{after: number; to: number}>;
  failed: boolean;
  /** The run has counted toward the cooldown (once per run, see below). */
  failureRecorded: boolean;
  done: number;
  total: number;
  /** The user's rows at the start, by id. */
  byId: Map<number, PostRecord>;
}

/** Total fetch attempts per page in the full-sync worker pool. */
export const SYNC_PAGE_MAX_ATTEMPTS = 5;

/**
 * Parallel page fetches in the full sync. With about 1 s of server time per
 * 200-post page and 400 ms between a worker's pages, 5 workers send about
 * 3.5 requests per second on average: this count, not the limiter's cap,
 * sets a lone sync's pace. The cap (`CONFIG.RATE_LIMITER.rps`, 4.5) only
 * trims the moments when pages come back faster, and those bursts are what
 * Cloudflare's rule in front of Danbooru refuses (about 50 requests per
 * 10 s, T-213).
 *
 * It was briefly 4 (T-211, about 2.9 req/s), when the 429s were read as a
 * two-minute budget; that reading was ruled out and the cap took over the
 * job (measured 2026-11-13: 4 workers at a 4.5 cap, no 429 in three full
 * syncs of a 46k-upload account, 100–131 s each).
 */
export const SYNC_WORKERS = 5;

/**
 * Numbered pages the full sync asks for before it re-anchors the search on
 * `id:>` the last post it has. Danbooru answers 410 past the viewer's page
 * limit (`User.page_limit`: 1000 below Gold, 5000 from Gold), which at 200
 * posts a page used to end a Member's sync of a larger account at 200,000
 * posts. 1000 fits every level.
 */
export const SYNC_SEGMENT_PAGES = 1000;

/** Posts per full-sync page: Danbooru's largest `limit`. */
const SYNC_PAGE_LIMIT = 200;

/**
 * Pages the full sync's reorder buffer may hold before the workers stop
 * claiming new ones (T-504). Pages commit in order, so one page stuck in
 * its retries let the others pile up behind it without bound; this caps
 * that at 5,000 posts in memory, and the requests sent meanwhile.
 */
export const SYNC_BUFFER_MAX_PAGES = 25;

/** How often a worker held by a full buffer looks again (T-504). */
const SYNC_BUFFER_POLL_MS = 250;

/**
 * `YYYY-MM-DD` of the day before `joinDate` (UTC), or null without a valid
 * date: the lower bound of the first-post lookup (T-508). A day's margin
 * covers the viewer's time zone, in which Danbooru reads a bare date.
 */
function dayBeforeJoin(joinDate: Date | undefined): string | null {
  const t = joinDate?.getTime();
  if (t === undefined || Number.isNaN(t)) return null;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Resolves once the reorder buffer has room for another page — true — or
 * false when the run ends meanwhile (T-504).
 */
async function waitForBufferRoom(
  buffer: Map<number, unknown>,
  running: () => boolean,
): Promise<boolean> {
  while (buffer.size >= SYNC_BUFFER_MAX_PAGES) {
    if (!running()) return false;
    await new Promise(r => setTimeout(r, SYNC_BUFFER_POLL_MS));
  }
  return running();
}

/** How the full-sync worker should react to a failed page fetch. */
export type SyncFetchErrorKind = 'rate-limit' | 'transient' | 'fatal';

/**
 * Classify a page-fetch failure in the full-sync worker.
 *
 * - `rate-limit`: HTTP 429. The shared rate limiter already paused the whole
 *   queue (global backoff), so the page is worth retrying after that pause.
 *   This used to be fatal, so one 429 deep into a 46k-post sync stopped the
 *   whole run at ~42k and left the user on a "Resume Sync" screen.
 * - `transient`: 5xx, the 30 s timeout abort, a dropped connection, or a
 *   truncated/HTML body that fails JSON parsing.
 * - `fatal`: any other 4xx, or an error we do not recognise. Retrying cannot
 *   change the answer.
 */
export function classifySyncFetchError(err: unknown): SyncFetchErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  const status = /^HTTP (\d{3})\b/.exec(message)?.[1];
  if (status === '429') return 'rate-limit';
  if (status) return Number(status) >= 500 ? 'transient' : 'fatal';

  // DOMException is not an Error subclass in every runtime, so read the name
  // off the object instead of relying on instanceof.
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as {name: unknown}).name)
      : '';
  // AbortError: our 30 s timeout. TypeError: fetch's network failure
  // ("Failed to fetch" / "NetworkError when attempting to fetch resource").
  // SyntaxError: a 200 response whose body was not the JSON we asked for.
  if (name === 'AbortError' || name === 'TypeError' || name === 'SyntaxError') {
    return 'transient';
  }
  return 'fatal';
}

/**
 * Wait before retry number `failures` (1-based count of failures so far).
 *
 * Transient errors back off exponentially (1 s, 2 s, 4 s, 8 s). A 429's
 * wait comes from the server: the rate limiter derives it from Danbooru's
 * `X-Rate-Limit` header and pauses its queue, and `limiterBackoffMs` is what
 * is left of that pause. Every retry waits it out here rather than queueing
 * into the paused limiter, where the request's 30 s timeout would keep
 * ticking (a server wait can reach ~30 s).
 */
export function syncRetryDelayMs(
  kind: SyncFetchErrorKind,
  failures: number,
  limiterBackoffMs: number = 0,
): number {
  const own = kind === 'rate-limit' ? 1000 : 1000 * Math.pow(2, failures - 1);
  return Math.max(own, limiterBackoffMs);
}

/** Count lookups for one stats run; remembers whether any were lost. */
interface CountBatch {
  lookup(query: string): Promise<number>;
  /** True once a count failed transiently even after its retry. */
  readonly failed: boolean;
}

/**
 * AnalyticsDataManager: Handles heavy data fetching for full history.
 */
export class AnalyticsDataManager extends DataManager {
  /**
   * Narrows the inherited `db: any` field on DataManager. The base class
   * declares `db: any` (will be tightened in sub-task 7.6); this declare
   * statement gives AnalyticsDataManager methods proper Dexie types
   * without changing runtime behavior.
   */
  declare db: Database;

  static isGlobalSyncing: boolean = false;
  static syncProgress: SyncProgress = {current: 0, total: 0, message: ''};
  static onProgressCallback:
    | ((current: number, total: number, message?: string) => void)
    | null = null;

  /**
   * Short-lived per-user memo for {@link getTotalPostCount}. Instance-scoped:
   * the callers that pile up within one interaction share a manager, and
   * keeping it off the class avoids leaking a count between page contexts.
   */
  private totalCountMemo = new Map<
    string,
    {at: number; promise: Promise<number>}
  >();

  /** One scan's local distributions per user ({@link getLocalDistributions}). */
  private localDistributionsMemo = new Map<
    number,
    {at: number; value: Promise<LocalDistributions | null>}
  >();

  /** One scan of a user's rows per dashboard open ({@link getRowSnapshot}). */
  private rowSnapshotMemo = new Map<
    number,
    {at: number; value: Promise<RowSnapshot>}
  >();

  /**
   * @param {Database} db The Dexie database instance.
   * @param {RateLimitedFetch} rateLimiter The tab's shared rate limiter.
   */
  constructor(db: Database, rateLimiter: RateLimitedFetch) {
    super(db, rateLimiter);
  }

  /**
   * Cache prelude shared by every distribution-stat fetcher. Skips the cache
   * read when forceRefresh is true or there is no uploaderId to key on.
   *
   * `maxAgeMs` (v9.6) lets count-driven distributions opt in to a TTL —
   * piestats records older than that age return null so the caller
   * refetches. Pass nothing to preserve the legacy "trust until reset"
   * behaviour for non-count caches (top posts, milestones, etc.).
   */
  private async tryGetCachedStats<T>(
    cacheKey: string,
    uploaderId: number | null,
    forceRefresh: boolean,
    maxAgeMs?: number,
  ): Promise<T | null> {
    if (forceRefresh || !uploaderId) return null;
    const cached = await this.getStats(cacheKey, uploaderId, maxAgeMs);
    return (cached as T | null) ?? null;
  }

  /**
   * Cache a freshly fetched stat only when every request behind it
   * succeeded. When some failed (typically a 429 during the post-sync
   * burst), the result holds zeros / nulls that mean "unknown", not "none";
   * saving it would serve the failure as fresh data for the whole cache
   * TTL — a rating pie with Explicit at 0, a Recent Popular widget saying
   * "No posts found". Instead the previous cached value is returned when
   * there is one (else the partial result), nothing is written, and the
   * next open retries.
   */
  private async cacheUnlessPartial<T>(
    cacheKey: string,
    uploaderId: number,
    result: T,
    failed: boolean,
  ): Promise<T> {
    if (!uploaderId) return result;
    if (!failed) {
      await this.saveStats(cacheKey, uploaderId, result);
      return result;
    }
    log.warn('Partial fetch not cached', {cacheKey});
    const previous = (await this.getStats(cacheKey, uploaderId)) as T | null;
    return previous ?? result;
  }

  /**
   * Count fetcher for one stats run. A transient failure (429, 5xx,
   * timeout, network) is retried once: after a 429 the retry queues behind
   * the rate limiter's pause and slow start, so it lands after the burst
   * that caused it. A count still lost after that flips `failed`, and the
   * caller passes it to `cacheUnlessPartial` — a ranking built on a 0 that
   * means "unknown" (a top character dropped from the pie) must not be cached.
   *
   * Deterministic 4xx failures (e.g. 422 for a search over the viewer's tag
   * limit) are not retried and do not count as lost: refetching cannot
   * change them, and refusing to cache would re-run them on every open.
   *
   * A `null` count ({@link CountUnavailableError}) is lost but not retried:
   * the server caches that `null` for 5 minutes, so the retry would only
   * spend a count-lane point to read it back.
   */
  private countBatch(): CountBatch {
    let failed = false;
    const fetchCount = async (query: string): Promise<number> => {
      try {
        return await this.fetchRemoteCount(query);
      } catch (first: unknown) {
        if (first instanceof CountUnavailableError) {
          failed = true;
          throw first;
        }
        if (classifySyncFetchError(first) === 'fatal') throw first;
        try {
          return await this.fetchRemoteCount(query);
        } catch (second: unknown) {
          if (
            second instanceof CountUnavailableError ||
            classifySyncFetchError(second) !== 'fatal'
          ) {
            failed = true;
          }
          throw second;
        }
      }
    };
    return {
      lookup: fetchCount,
      get failed() {
        return failed;
      },
    };
  }

  /**
   * Centrally selects the most appropriate thumbnail URL for a post.
   * Prioritizes high-quality WebP variants (720x720 or 360x360) for performance.
   * @param {Object} post The post data object from Danbooru API.
   * @return {string} The selected thumbnail URL.
   */
  /**
   * Fetches a thumbnail URL with built-in retry logic for handling rate limits.
   * Implements exponential backoff on 429 status codes.
   * @param {string} tags The tag string to search for.
   * @param {number=} retries Number of allowed retries (default: 3).
   * @param {number=} delay Initial delay in ms before retry (default: 2000).
   * @return {Promise<string>} The preview URL or an empty string if not found or failed.
   */
  async fetchThumbnailWithRetry(
    tags: string,
    retries: number = 3,
    delay: number = 2000,
  ): Promise<string> {
    // The pie tooltip shows it at 80×80: the 180×180 preview is enough, so
    // no `media_asset[variants]` here (T-506).
    const url = `/posts.json?tags=${encodeURIComponent(tags)}&limit=1&only=preview_file_url,rating`;
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await this.rateLimiter.fetch(url);
        if (resp.status === 429) {
          await new Promise(r => setTimeout(r, delay + Math.random() * 2000));
          delay *= 2;
          continue;
        }
        if (resp.status === 422) return ''; // Unprocessable query — no point retrying
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          return getBestThumbnailUrl(data[0]);
        }
        return '';
      } catch (e: unknown) {
        if (i === retries - 1) {
          log.warn(`Failed thumb fetch after ${retries} tries`, {
            tags,
            error: e,
          });
          return '';
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
    return '';
  }

  /**
   * Retrieves synchronization statistics for a specific user from the local database.
   * @param {!Object} userInfo The user's information object.
   * @return {Promise<{count: number, lastSync: ?string}>} Object containing post count and last sync date.
   */
  async getSyncStats(
    userInfo: TargetUser,
  ): Promise<{count: number; lastSync: string | null}> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return {count: 0, lastSync: null};

    // Walks the [uploader_id+created_at] compound index (DB v11) from the
    // newest post backwards and stops at the first hit — so the latest entry
    // for this specific user is resolved in O(log n) instead of scanning the
    // full posts table (which also previously risked returning another
    // user's latest created_at).
    const [count, lastEntry] = await Promise.all([
      this.db.posts.where('uploader_id').equals(uploaderId).count(),
      this.db.posts
        .where('[uploader_id+created_at]')
        .between([uploaderId, ''], [uploaderId, '\uffff'])
        .last(),
    ]);

    return {
      count,
      lastSync: lastEntry ? lastEntry.created_at : null,
    };
  }

  /**
   * Calculates summary statistics including max uploads, streaks, and active days.
   * Iterates through all synced posts for the user to determine the most active day and longest upload streak.
   * @param {!Object} userInfo The user's information object.
   * @return {Promise<{maxUploads: number, maxDate: string, firstUploadDate: ?Date, lastUploadDate: ?Date, count1Year: number, maxUploads1Year: number, maxDate1Year: string, maxStreak: number, maxStreakStart: ?string, maxStreakEnd: ?string, activeDays: number}>} Summary stats.
   */
  async getSummaryStats(userInfo: TargetUser): Promise<SummaryStats> {
    const empty = () =>
      ({
        maxUploads: 0,
        maxDate: 'N/A',
        firstUploadDate: null,
        lastUploadDate: null,
      }) as SummaryStats;
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return empty();

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // From the open's one scan of the rows (T-501), in the same row order.
    const {points, days} = await this.getRowSnapshot(uploaderId);
    if (points.length === 0) return empty();

    const tally = tallyUploadDays(points, days, oneYearAgo);
    const sortedDates = Object.keys(tally.historyAll).sort();
    const all = busiestDay(tally.historyAll);
    const lastYear = busiestDay(tally.history1Year);
    const streak = longestStreak(sortedDates);

    return {
      maxUploads: all.count,
      maxDate: all.date,
      firstUploadDate: tally.first,
      lastUploadDate: tally.last,
      count1Year: tally.count1Year,
      maxUploads1Year: lastYear.count,
      maxDate1Year: lastYear.date,
      maxStreak: streak.length,
      maxStreakStart: streak.start,
      maxStreakEnd: streak.end,
      activeDays: sortedDates.length,
    };
  }

  /**
   * Retrieves milestone posts (e.g., 1st, 100th, 1000th) based on local sequence.
   * Automatically adjusts step size based on total post count if 'auto' is selected.
   * @param {!Object} userInfo The user's information object.
   * @param {boolean=} isNsfwEnabled Whether to fetch thumbnails for all posts regardless of rating.
   * @param {(string|number)=} customStep Step interval ('auto' or a number).
   * @return {Promise<!Array<{type: string, post: !Object, index: number}>>} List of milestone posts.
   */
  /**
   * Builds the milestone target sequence (numeric values only) for a given
   * total post count and step mode. Used by both `getMilestones` (to look up
   * cached posts at those target positions) and `getNextMilestone` (to find
   * the smallest target above the current total). Pure / no DB access.
   */
  // T-26 baseline: complexity 24. Step modes auto/repdigit/N + spacing
  // tables + total-magnitude branches. Stable, well-tested.
  // eslint-disable-next-line complexity
  buildMilestoneTargets(
    total: number,
    customStep: 'auto' | 'repdigit' | number,
  ): number[] {
    const targets: number[] = [];

    if (customStep === 'repdigit') {
      // Repdigit milestones: 111, 222, ..., 999, 1111, ..., 9999, 11111, ...
      targets.push(1);
      if (total >= 11) targets.push(11);
      for (let digits = 3; digits <= 6; digits++) {
        for (let d = 1; d <= 9; d++) {
          const num = parseInt(String(d).repeat(digits));
          if (num <= total) targets.push(num);
        }
      }
    } else if (customStep !== 'auto' && typeof customStep === 'number') {
      const step = customStep as number;
      targets.push(1);
      for (let i = step; i <= total; i += step) {
        targets.push(i);
      }
    } else {
      // Case 1: Small (< 1,500) -> 1, 100, 200...
      if (total < 1500) {
        targets.push(1);
        for (let i = 100; i <= total; i += 100) {
          targets.push(i);
        }
      }
      // Case 2: Medium (1,500 ~ 10,000) -> 1, 100, 500, 1000, 1500, 2000...
      else if (total <= 10000) {
        targets.push(1);
        if (total >= 100) targets.push(100);
        for (let i = 500; i <= total; i += 500) {
          targets.push(i);
        }
      }
      // Case 4: Huge (> 100,000) -> 1, 100, 1000, 5000, 10000, ... (Step 5000)
      else if (total > 100000) {
        targets.push(1);
        if (total >= 100) targets.push(100);
        if (total >= 1000) targets.push(1000);
        for (let i = 5000; i <= total; i += 5000) {
          targets.push(i);
        }
      }
      // Case 3: Very Large (> 50,000) -> 1, 100, 1000, 2500, 5000, ... (Step 2500)
      else if (total > 50000) {
        targets.push(1);
        if (total >= 100) targets.push(100);
        if (total >= 1000) targets.push(1000);
        for (let i = 2500; i <= total; i += 2500) {
          targets.push(i);
        }
      }
      // Case 2: Large (> 10,000) -> 1, 100, 1000, 2000...
      else {
        targets.push(1);
        if (total >= 100) targets.push(100);
        for (let i = 1000; i <= total; i += 1000) {
          targets.push(i);
        }
      }
    }

    return [...new Set(targets)].sort((a, b) => a - b);
  }

  /**
   * Computes the next (un-reached) milestone target above `total`. Used by
   * the placeholder card at the end of the milestones grid. Returns null if
   * the mode genuinely has no next value (it shouldn't, but kept defensive).
   */
  // T-26 baseline: complexity 16. Mirrors buildMilestoneTargets' branching
  // for the "what comes after `total`" question.
  // eslint-disable-next-line complexity
  getNextMilestone(
    total: number,
    customStep: 'auto' | 'repdigit' | number,
  ): number | null {
    if (customStep === 'repdigit') {
      // Repdigits below 11: 1 → 11 → 111 → 222 → ... → 999 → 1111 → ...
      if (total < 1) return 1;
      if (total < 11) return 11;
      for (let digits = 3; digits <= 7; digits++) {
        for (let d = 1; d <= 9; d++) {
          const num = parseInt(String(d).repeat(digits));
          if (num > total) return num;
        }
      }
      return null;
    }

    if (customStep !== 'auto' && typeof customStep === 'number') {
      const step = customStep;
      if (total < 1) return 1;
      // Next multiple of step strictly greater than total
      return Math.floor(total / step) * step + step;
    }

    // Auto mode — pick the step the same way buildMilestoneTargets would
    // for the *next* count and find the smallest milestone > total.
    if (total < 1) return 1;
    if (total < 100) return 100;
    let step: number;
    if (total < 1500) step = 100;
    else if (total <= 10000) step = 500;
    else if (total <= 50000) step = 1000;
    else if (total <= 100000) step = 2500;
    else step = 5000;
    return Math.floor(total / step) * step + step;
  }

  /**
   * Fetches milestone rows' thumbnails (`media_asset[variants]` and the
   * preview), 100 ids a request, and stores them on the rows — `variants`
   * an empty list for an id Danbooru answered without them or not at all,
   * so the row is not asked again (T-506). A failed request stores nothing.
   */
  private async lookUpMilestoneThumbnails(
    ids: number[],
    rows: PostRecord[],
  ): Promise<void> {
    const chunkSize = 100;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const url = `${this.baseUrl}/posts.json?tags=id:${chunk.join(',')}&limit=${chunkSize}&only=id,media_asset[variants],rating,preview_file_url`;
      const res = await this.rateLimiter.fetch(url);
      if (!res.ok) continue;
      const fetched: DanbooruPost[] = await res.json();
      const byId = new Map(fetched.map(p => [p.id, p]));
      for (const id of chunk) {
        const local = rows.find(r => r.id === id);
        if (!local) continue;
        const item = byId.get(id);
        const patch: Partial<PostRecord> = {
          variants: item?.media_asset?.variants ?? [],
          preview_file_url: item?.preview_file_url,
          rating: item?.rating ?? local.rating,
        };
        Object.assign(local, patch);
        this.db.posts
          .update(id, patch)
          .catch((e: unknown) =>
            log.error('Failed to update post in DB', {postId: id, error: e}),
          );
      }
    }
  }

  async getMilestones(
    userInfo: TargetUser,
    isNsfwEnabled: boolean = false,
    customStep: 'auto' | 'repdigit' | number = 'auto',
    forceRefresh: boolean = false,
  ): Promise<MilestoneEntry[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];

    const total = await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .count();
    if (total === 0) return [];

    // Cache key includes step and nsfw flag — thumbnails for NSFW posts are
    // only fetched when the flag is on, so results differ per combination.
    //
    // Count-stamped: the milestone list is a pure function of (post count,
    // step, nsfw), so a changed post count invalidates it. A sidecar
    // `__count` key records the count the entries were computed for; on read
    // a mismatch (or a missing/legacy stamp) forces a recompute. This is
    // required because the widget's default 'auto' step is never warmed by a
    // sync (refreshCriticalStats/SWR only warm step=1000) and getStats has no TTL —
    // without the stamp the 'auto' list froze at the first-render count while
    // the widget's live totalPosts/nextTarget kept advancing, corrupting the
    // progress bar. The entries payload stays a plain MilestoneEntry[] so the
    // milestones_1000 SWR direct-read (history-chart stars) is unaffected.
    //
    // Known edge (intentional): the stamp is the count alone, so a re-sync that
    // deletes one older post and adds one (count unchanged, `no` positions
    // shifted) reads as a hit and serves a slightly stale milestone post. It
    // is rare and self-heals on the next count change; a {count, maxId} stamp
    // would close it but adds a query to every cache-hit path — not worth it.
    const cacheKey = `milestones_${customStep}_${isNsfwEnabled ? '1' : '0'}`;
    const stampKey = `${cacheKey}__count`;
    if (!forceRefresh) {
      const [cached, stamp] = await Promise.all([
        this.getStats(cacheKey, uploaderId),
        this.getStats(stampKey, uploaderId) as Promise<number | null>,
      ]);
      if (cached && stamp === total) return cached as MilestoneEntry[];
    }

    const targets = this.buildMilestoneTargets(total, customStep);

    // Use compound index [uploader_id+no] to fetch only this user's posts at the target positions
    const matches: PostRecord[] = await this.db.posts
      .where('[uploader_id+no]')
      .anyOf(targets.map((no: number) => [uploaderId, no]))
      .toArray();

    // Thumbnails are shown for Safe(s) / General(g) posts, or all when NSFW is
    // on, in the larger sizes (G-3) only a lookup brings: the sync stores no
    // thumbnail (T-506). A row is looked up once — its `variants` keeps the
    // answer, an empty list when Danbooru gave none (a banned post for a
    // viewer below Approver) — until a sync or a catch-up rewrites it.
    // Before, the test was "no thumbnail URL", and earlier still "no
    // `variants`" read from a field Danbooru never sends, which sent a
    // lookup on every recompute (one drew an edge 429 after a full sync).
    const missingIds = matches
      .filter(p => isNsfwEnabled || p.rating === 's' || p.rating === 'g')
      .filter(p => p.variants === undefined)
      .map(p => p.id);
    if (missingIds.length > 0) {
      try {
        await this.lookUpMilestoneThumbnails(missingIds, matches);
      } catch (e: unknown) {
        log.warn('Failed to fetch missing milestone thumbnails', {error: e});
      }
    }

    // Map back to result structure
    // Create lookup
    const map = new Map(matches.map(p => [p.no, p]));

    const results: MilestoneEntry[] = [];

    targets.forEach(t => {
      // Just push specific targets
      const p = map.get(t);
      if (p) {
        // Label logic
        let label = `#${t.toLocaleString()}`;
        if (t >= 1000 && t % 1000 === 0) label = `${t / 1000} k`;
        // Repdigit label: show the number itself (e.g. "111", "2222")
        const tStr = String(t);
        if (tStr.length >= 3 && tStr.split('').every(c => c === tStr[0]))
          label = tStr;
        if (t === 1) label = 'First';

        results.push({type: label, post: p, milestone: t});
      }
    });

    // Let's sort strictly by milestone ASC.
    results.sort((a, b) => a.milestone - b.milestone);

    // Persist entries + the count they were computed for (sidecar stamp).
    await Promise.all([
      this.saveStats(cacheKey, uploaderId, results),
      this.saveStats(stampKey, uploaderId, total),
    ]);
    return results;
  }

  /**
   * Aggregates post counts by month from the local IndexedDB.
   * Handles linear timeline generation by filling gaps with 0-count months.
   * @param {!Object} userInfo The user's information object.
   * @param {?Date=} minDate Optional start date to ensure the timeline begins at a specific point.
   * @return {Promise<!Array<{date: string, count: number, label: string}>>} Array of monthly stats.
   */
  async getMonthlyStats(
    userInfo: TargetUser,
    minDate: Date | null = null,
  ): Promise<MonthlyStatEntry[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];

    const counts: Record<string, number> = {}; // "2023-01": 5

    // From the open's one scan of the rows (T-501): a day key's first seven
    // characters are `created_at`'s ("YYYY-MM").
    const {days} = await this.getRowSnapshot(uploaderId);
    for (const day of days) {
      const month = day.substring(0, 7);
      counts[month] = (counts[month] || 0) + 1;
    }

    // Convert to array and Fill Gaps for Linear timeline
    let results: MonthlyStatEntry[] = [];
    const keys = Object.keys(counts).sort();

    if (keys.length > 0) {
      let startKey = keys[0];
      const endKey = keys[keys.length - 1];

      // Extend start date if minDate is provided and earlier
      if (minDate) {
        const mY = minDate.getFullYear();
        const mM = minDate.getMonth() + 1;
        const mKey = `${mY}-${String(mM).padStart(2, '0')}`;
        if (mKey < startKey) startKey = mKey;
      }

      let [y, m] = startKey.split('-').map(Number);
      const [endY, endM] = endKey.split('-').map(Number);

      // Loop until we pass endYear/endMonth
      while (y < endY || (y === endY && m <= endM)) {
        const k = `${y}-${String(m).padStart(2, '0')}`;
        results.push({
          date: k,
          count: counts[k] || 0,
          label: k,
        });

        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
    } else {
      // No data
      results = [];
    }

    return results;
  }

  /**
   * Fetches rating distribution report from Danbooru's /reports/posts.json endpoint.
   * @param {!Object} userInfo The user's information object.
   * @return {Promise<!Array<{rating: string, count: number, label: string}>>} Rating distribution array.
   */
  /**
   * Fetches post counts for each status (active, deleted, etc.).
   * @param {!Object} userInfo The user's information object.
   * @param {?string|Date} startDate Optional start date to optimize query range.
   * @return {Promise<!Array<{name: string, count: number, label: string}>>} Status distribution.
   */
  async getStatusDistribution(
    userInfo: TargetUser,
    startDate: string | Date | null = null,
    forceRefresh: boolean = false,
  ): Promise<{name: string; count: number; label: string}[]> {
    if (!userInfo.name) return [];

    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'status_dist';

    const cached = await this.tryGetCachedStats<
      {name: string; count: number; label: string}[]
    >(cacheKey, uploaderId, forceRefresh, getCountCacheTtlMs());
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const statuses = [
      'active',
      'appealed',
      'banned',
      'deleted',
      'flagged',
      'pending',
    ];

    // Local rows (T-406): every status but appealed — an appeal pending on
    // a deleted post is not a post field, so it stays one count (N-07).
    const local = await this.getLocalDistributions(uploaderId);
    if (local) {
      const counts = this.countBatch();
      let appealed = 0;
      try {
        appealed = await counts.lookup(
          `user:${normalizedName} status:appealed`,
        );
      } catch (e: unknown) {
        log.warn('Failed to fetch count for status', {
          status: 'appealed',
          error: e,
        });
      }
      const result = statuses.map(status => ({
        name: status,
        count:
          status === 'appealed'
            ? appealed
            : local.status[status as keyof typeof local.status],
        label: status.charAt(0).toUpperCase() + status.slice(1),
      }));
      return this.cacheUnlessPartial(
        cacheKey,
        uploaderId,
        result,
        counts.failed,
      );
    }

    const counts = this.countBatch();
    const tasks = statuses.map(async status => {
      try {
        let tagQuery = `user:${normalizedName} status:${status}`;
        if (startDate) {
          const dateStr =
            startDate instanceof Date
              ? startDate.toISOString().split('T')[0]
              : startDate;
          tagQuery += ` date:>=${dateStr}`;
        }

        const count = await counts.lookup(tagQuery);
        return {
          name: status,
          count,
          label: status.charAt(0).toUpperCase() + status.slice(1),
        };
      } catch (e: unknown) {
        log.warn('Failed to fetch count for status', {status, error: e});
        return {
          name: status,
          count: 0,
          label: status.charAt(0).toUpperCase() + status.slice(1),
        };
      }
    });

    const result = await Promise.all(tasks);
    return this.cacheUnlessPartial(cacheKey, uploaderId, result, counts.failed);
  }

  /**
   * Fetches rating distribution report from Danbooru's /counts/posts.json endpoint.
   * Uses parallel requests for each rating to ensure accuracy (including 'general').
   * @param {!Object} userInfo The user's information object.
   * @param {?string|Date} startDate Optional start date to optimize query range.
   * @return {Promise<!Array<{rating: string, count: number, label: string}>>} Rating distribution array.
   */
  async getRatingDistribution(
    userInfo: TargetUser,
    startDate: string | Date | null = null,
    forceRefresh: boolean = false,
  ): Promise<{rating: string; count: number; label: string}[]> {
    if (!userInfo.name) return [];

    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'rating_dist';

    const cached = await this.tryGetCachedStats<
      {rating: string; count: number; label: string}[]
    >(cacheKey, uploaderId, forceRefresh, getCountCacheTtlMs());
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const ratings = ['g', 's', 'q', 'e'];
    const labelMap: Record<string, string> = {
      g: 'General',
      s: 'Sensitive',
      q: 'Questionable',
      e: 'Explicit',
    };

    // Local rows (T-406): no count at all.
    const local = await this.getLocalDistributions(uploaderId);
    if (local) {
      const result = ratings.map(rating => ({
        rating,
        count: local.rating[rating] ?? 0,
        label: labelMap[rating],
      }));
      return this.cacheUnlessPartial(cacheKey, uploaderId, result, false);
    }

    const counts = this.countBatch();
    const tasks = ratings.map(async rating => {
      try {
        let tagQuery = `user:${normalizedName} rating:${rating}`;
        if (startDate) {
          const dateStr =
            startDate instanceof Date
              ? startDate.toISOString().split('T')[0]
              : startDate;
          tagQuery += ` date:>=${dateStr}`;
        }

        const count = await counts.lookup(tagQuery);
        return {rating, count, label: labelMap[rating]};
      } catch (e: unknown) {
        log.warn('Failed to fetch count for rating', {rating, error: e});
        return {rating, count: 0, label: labelMap[rating]};
      }
    });

    try {
      const results = await Promise.all(tasks);
      return this.cacheUnlessPartial(
        cacheKey,
        uploaderId,
        results,
        counts.failed,
      );
    } catch (e: unknown) {
      log.error('Failed to fetch rating distribution', {error: e});
      return [];
    }
  }

  /**
   * Fetches tag cloud data for a user from the related tags API.
   * Selects top 30 tags by cosine similarity (relevance to the user),
   * then sorts by frequency for font size mapping.
   * Results are cached in the piestats table with a `tag_cloud_` prefix.
   *
   * Cache is TTL-gated by `getCountCacheTtlMs()` (default 10 min, same
   * knob as count distributions). No longer force-refreshed on the blocking
   * sync path (removed from `refreshCriticalStats`); the General tab warms
   * via `fetchDashboardData`'s SWR revalidate post-paint, and the widget's
   * per-category tab switch re-fetches with `forceRefresh=true`. This keeps
   * the General tab's Lift filter (v9.6.0) current without blocking the open.
   *
   * @param userInfo The target user.
   * @param categoryId Danbooru tag category (0=General, 1=Artist, 3=Copyright, 4=Character).
   * @param forceRefresh Bypass cache and re-fetch.
   * @return Tag cloud items sorted by frequency descending.
   */
  async getTagCloudData(
    userInfo: TargetUser,
    categoryId: number,
    forceRefresh: boolean = false,
  ): Promise<TagCloudItem[]> {
    if (!userInfo.name) return [];

    const categoryNames: Record<number, string> = {
      0: 'general',
      1: 'artist',
      3: 'copyright',
      4: 'character',
    };
    const catName = categoryNames[categoryId] || `cat${categoryId}`;
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = `tag_cloud_${catName}`;

    const cached = await this.tryGetCachedStats<TagCloudItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    // General: select by Cosine similarity (user-characteristic tags)
    // Others: select by Frequency (most common tags)
    const order = categoryId === 0 ? 'Cosine' : 'Frequency';
    // General fetches a wider window (50) because the Lift filter below
    // drops globally-common tags — top 30 by Cosine alone would otherwise
    // leave the cloud sparse after filtering.
    const limit = categoryId === 0 ? 50 : 30;
    const url = `/related_tag.json?commit=Search&search[category]=${categoryId}&search[order]=${order}&search[query]=user:${encodeURIComponent(normalizedName)}&limit=${limit}`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
        return [];

      const queryPostCount: number = resp.post_count || 0;
      let entries: TagCloudFilterEntry[] = (
        resp.related_tags as DanbooruRelatedTag[]
      ).map(item => ({
        tagName: item.tag.name,
        frequency: item.frequency,
        userCount: Math.round(item.frequency * queryPostCount),
      }));

      if (categoryId === 0) {
        const [globalTotal, topGlobalTags] = await Promise.all([
          getGlobalTotalPosts(this.rateLimiter),
          getGlobalTopGeneralTags(this.rateLimiter),
        ]);
        entries = applyGeneralTagCloudFilter(
          entries,
          topGlobalTags,
          globalTotal,
          LIFT_THRESHOLD,
          USER_COUNT_FLOOR,
        );
      }

      // Select top 30 (preserves Cosine/Frequency order from Danbooru),
      // then sort by frequency for font-size mapping in the cloud.
      const items: TagCloudItem[] = entries
        .slice(0, 30)
        .map(entry => ({
          name: entry.tagName.replace(/_/g, ' '),
          tagName: entry.tagName,
          frequency: entry.frequency,
          count: entry.userCount,
        }))
        .sort((a: TagCloudItem, b: TagCloudItem) => b.frequency - a.frequency);

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, items);
      return items;
    } catch (e: unknown) {
      log.debug('Failed to fetch tag cloud data', {error: e});
      return [];
    }
  }

  /**
   * Parses NNTBot forum post body to extract "New General Tags" created by a target user.
   * Exported as static for testability.
   *
   * DText format:
   *   [td][[tag name]] "»":[/posts?tags=...] [/td]
   *   [td]"Username":[/users/12345][/td]
   *
   * @param body The DText body of a forum post.
   * @param targetUser The username to filter by (case-insensitive).
   * @param reportDate The date of the report (YYYY-MM-DD).
   * @return Array of {tagName, reportDate} for tags created by the target user.
   */
  static parseNewGeneralTags(
    body: string,
    targetUser: string,
    reportDate: string,
  ): {tagName: string; reportDate: string}[] {
    const results: {tagName: string; reportDate: string}[] = [];
    const userLower = targetUser.toLowerCase();

    // Find "New General Tags" section
    const sectionStart = body.indexOf('New General Tags');
    if (sectionStart === -1) return results;

    // Find next section header (h4. or h5.) to limit scope
    const afterSection = body.slice(sectionStart);
    const nextSectionMatch = afterSection.slice(20).search(/\bh[45]\.\s/);
    const sectionBody =
      nextSectionMatch >= 0
        ? afterSection.slice(0, nextSectionMatch + 20)
        : afterSection;

    // Extract rows: look for [td][[tag_name]]...[/td] followed by [td]"Username":...
    // Match pairs of consecutive [tr]...[/tr] blocks
    const rowRegex = /\[td\]\[\[(.+?)\]\].*?\[\/td\]\s*\[td\](.*?)\[\/td\]/g;
    let match;
    while ((match = rowRegex.exec(sectionBody)) !== null) {
      const tagDisplay = match[1]; // e.g. "gyaru v" or "mite (idolmaster)"
      const updaterCell = match[2]; // e.g. "AkaringoP":[/users/701499]

      // Check if target user is in the updater cell (case-insensitive)
      if (updaterCell.toLowerCase().includes(userLower)) {
        // Convert display name to raw tag name (spaces → underscores)
        const tagName = tagDisplay.trim().replace(/ /g, '_');
        results.push({tagName, reportDate});
      }
    }

    return results;
  }

  /**
   * Fetches tags created by a user from NNTBot forum reports.
   * Automatically searches previous usernames via user_name_change_requests API.
   * Results are enriched with current tag status and alias info.
   *
   * @param userInfo The target user.
   * @param onProgress Optional progress callback for UI updates.
   * @return Created tag items sorted by post count descending.
   */
  // T-26 baseline: complexity 33. Multi-stage pipeline (page fetch ×
  // implication batching × tag-status enrichment × NSFW filter × cache
  // merge). Decomposition candidate.
  // eslint-disable-next-line complexity
  async getCreatedTags(
    userInfo: TargetUser,
    onProgress?: (message: string) => void,
  ): Promise<CreatedTagItem[]> {
    if (!userInfo.name) return [];

    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'created_tags';

    // Check cache (count-driven: refetch when the TTL elapses so per-tag
    // counts surfaced in this widget don't lag behind Danbooru).
    if (uploaderId) {
      const cached = await this.getStats(
        cacheKey,
        uploaderId,
        getCountCacheTtlMs(),
      );
      if (cached) return cached as CreatedTagItem[];
    }

    const report = onProgress || (() => {});

    try {
      // Step 0: Collect all usernames (current + previous)
      const userNames: string[] = [userInfo.name];
      if (uploaderId) {
        report('Checking previous usernames...');
        try {
          const ncUrl = `/user_name_change_requests.json?search[user_id]=${uploaderId}&limit=500`;
          const ncResp = await this.rateLimiter
            .fetch(ncUrl)
            .then(r => r.json());
          if (Array.isArray(ncResp)) {
            for (const nc of ncResp) {
              if (nc.original_name && !userNames.includes(nc.original_name)) {
                userNames.push(nc.original_name);
              }
            }
          }
        } catch {
          /* proceed with current name only */
        }
      }

      // Step 1: Fetch forum posts for each username
      const rawTags: {tagName: string; reportDate: string}[] = [];
      const seenTags = new Set<string>();

      for (let ni = 0; ni < userNames.length; ni++) {
        const name = userNames[ni];
        report(
          `Searching reports for ${name}... (${ni + 1}/${userNames.length})`,
        );

        const searchQuery = `tag report ${name}`;
        const url = `/forum_posts.json?search[body_matches]=${encodeURIComponent(searchQuery)}&limit=500`;
        const posts = await this.rateLimiter.fetch(url).then(r => r.json());

        if (!Array.isArray(posts)) continue;

        for (const post of posts) {
          const body: string = post.body || '';
          const dateMatch = body.match(/Daily Report \((\d{4}-\d{2}-\d{2})\)/);
          const reportDate = dateMatch
            ? dateMatch[1]
            : (post.created_at || '').slice(0, 10);

          const parsed = AnalyticsDataManager.parseNewGeneralTags(
            body,
            name,
            reportDate,
          );
          for (const tag of parsed) {
            if (!seenTags.has(tag.tagName)) {
              seenTags.add(tag.tagName);
              rawTags.push(tag);
            }
          }
        }
      }

      if (rawTags.length === 0) return [];

      report(`Found ${rawTags.length} tags. Fetching current status...`);

      // Step 2: Batch fetch current tag status
      const tagNames = rawTags.map(t => t.tagName);
      const tagStatusMap = new Map<
        string,
        {postCount: number; isDeprecated: boolean}
      >();

      for (let i = 0; i < tagNames.length; i += 100) {
        const batch = tagNames.slice(i, i + 100);
        report(
          `Fetching tag status... (${Math.min(i + 100, tagNames.length)}/${tagNames.length})`,
        );
        const tagsUrl = `/tags.json?search[name_comma]=${encodeURIComponent(batch.join(','))}&only=name,post_count,is_deprecated&limit=500`;
        const tagsResp = await this.rateLimiter
          .fetch(tagsUrl)
          .then(r => r.json());
        if (Array.isArray(tagsResp)) {
          for (const t of tagsResp) {
            tagStatusMap.set(t.name, {
              postCount: t.post_count || 0,
              isDeprecated: t.is_deprecated || false,
            });
          }
        }
      }

      // Step 3: Check aliases (only for post_count=0 tags — aliased tags have posts moved)
      const emptyTagNames = tagNames.filter(name => {
        const status = tagStatusMap.get(name);
        return !status || status.postCount === 0;
      });

      report(`Checking aliases for ${emptyTagNames.length} empty tags...`);
      const aliasMap = new Map<string, string>();
      let aliasChecked = 0;

      await this.mapConcurrent(emptyTagNames, 5, async (name: string) => {
        try {
          const aliasUrl = `/tag_aliases.json?search[antecedent_name]=${encodeURIComponent(name)}&search[status]=active&limit=1`;
          const aliasResp = await this.rateLimiter
            .fetch(aliasUrl)
            .then(r => r.json());
          if (Array.isArray(aliasResp) && aliasResp.length > 0) {
            aliasMap.set(name, aliasResp[0].consequent_name);
          }
        } catch {
          /* skip */
        }
        aliasChecked++;
        if (aliasChecked % 10 === 0 || aliasChecked === emptyTagNames.length) {
          report(
            `Checking aliases... (${aliasChecked}/${emptyTagNames.length})`,
          );
        }
        return null;
      });

      // Step 4: Fetch post counts for aliased tags (consequent tag's count)
      const aliasedNames = Array.from(aliasMap.values());
      const aliasPostCounts = new Map<string, number>();
      if (aliasedNames.length > 0) {
        report('Fetching aliased tag counts...');
        for (let i = 0; i < aliasedNames.length; i += 100) {
          const batch = aliasedNames.slice(i, i + 100);
          const tagsUrl = `/tags.json?search[name_comma]=${encodeURIComponent(batch.join(','))}&only=name,post_count&limit=500`;
          const tagsResp = await this.rateLimiter
            .fetch(tagsUrl)
            .then(r => r.json());
          if (Array.isArray(tagsResp)) {
            for (const t of tagsResp) {
              aliasPostCounts.set(t.name, t.post_count || 0);
            }
          }
        }
      }

      report('Finalizing...');

      // Step 5: Assemble results
      const items: CreatedTagItem[] = rawTags.map(raw => {
        const status = tagStatusMap.get(raw.tagName);
        const alias = aliasMap.get(raw.tagName) || null;
        // For aliased tags, show the consequent tag's post count
        const postCount = alias
          ? (aliasPostCounts.get(alias) ?? 0)
          : (status?.postCount ?? 0);
        return {
          tagName: raw.tagName,
          displayName: raw.tagName.replace(/_/g, ' '),
          postCount,
          isDeprecated: status?.isDeprecated ?? false,
          aliasedTo: alias,
          reportDate: raw.reportDate,
        };
      });

      // Sort by post count descending
      items.sort((a, b) => b.postCount - a.postCount);

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, items);
      return items;
    } catch (e: unknown) {
      log.debug('Failed to fetch created tags', {error: e});
      return [];
    }
  }

  /**
   * Fetches character distribution using Danbooru's related tags API.
   * Processes top 10 characters and fetches their specific uploader counts concurrently.
   * @param {!Object} userInfo The user's information object.
   * @param {boolean=} forceRefresh Whether to skip cache and force a new fetch.
   * @param {?function(string)=} reportSubStatus Optional callback for progress updates.
   * @return {Promise<!Array<{name: string, count: number, frequency: number, isOther: boolean}>>} Character distribution.
   */
  async getCharacterDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus('Fetching Character Distribution...');
    const uploaderId = parseInt(userInfo.id || '0'); // Need ID for cache key
    const cacheKey = 'character_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const local = await this.getLocalDistributions(uploaderId);
    if (local) {
      return this.localTagDistribution(
        'character',
        userInfo,
        local,
        reportSubStatus,
      );
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    // limit=1000 (server caps at 500): the sub-tag breakdown wires
    // user-having from this response, so the default 100-row cutoff was
    // dropping subs the user actually has but use less often than the
    // top-100 cutoff (e.g. fate/apocrypha at frequency 0.001). 500 rows
    // covers the long tail without measurable cost (~50 KB response).
    const url = `/related_tag.json?commit=Search&search[category]=4&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}&limit=1000`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());

      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
        return [];

      const tags: DanbooruRelatedTag[] = resp.related_tags;

      // Dynamic candidate pool by total post count. Large dispersed users
      // (Fate/Hololive-class) need a wider net than the legacy fixed 10
      // because `/related_tag.json` frequency is estimated from at most
      // 5,000 md5-ordered posts — true top-10 character tags can land
      // outside the 11+ window. See [related-tag-rerank.ts].
      const N = await this.getTotalPostCount(userInfo);
      const {filtered: filteredCap, raw: rawCap} = charPoolSize(N);

      // Frequency-ordered raw candidates (pre-filter), 1.5× margin so
      // variant-heavy fandoms still yield `filteredCap` survivors.
      const rawCandidates: DanbooruRelatedTag[] = tags.slice(0, rawCap);

      // Top-level filter (filterTopLevelCandidates), shared with copy/fav.
      // Variants like `abigail_williams_(first_ascension)_(fate)`
      // collapse into the base tag's sub-tag breakdown instead of
      // competing for a top-10 slot.
      const filteredCandidates = (
        await this.filterTopLevelCandidates(rawCandidates, userInfo)
      ).slice(0, filteredCap);

      // Pre-rerank candidate items. `_item` carries the source row so
      // count-fetch can fall back to its global post_count; stripped
      // before the array escapes.
      const preItems: Array<
        DistributionItem & {_item?: DanbooruRelatedTag; tagName: string}
      > = filteredCandidates.map(item => ({
        name: item.tag.name.replace(/_/g, ' '),
        tagName: item.tag.name,
        count: 0,
        frequency: item.frequency,
        thumb: null,
        isOther: false,
        _item: item,
      }));

      // Accurate per-tag count fetch. Counts feed `selectTopKByCount`
      // below — accurate ranks beat the frequency estimate. Concurrency
      // 6 sits under the rate limiter's 8-slot ceiling and absorbs the
      // wider candidate pool.
      await perfLogger.wrap(
        'dbi:db:refresh:mapConcurrent',
        () =>
          this.mapConcurrent(preItems, 6, async obj => {
            if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
            try {
              const c = await counts.lookup(
                `user:${normalizedName} ${obj.tagName}`,
              );
              obj.count = c || obj._item?.tag.post_count || 0;
            } catch (_e: unknown) {
              log.debug('Failed to fetch user tag count', {error: _e});
            }
          }),
        {distribution: 'character', n: preItems.length, concurrency: 6},
      );

      // Rerank by count desc → frequency desc → tagName asc, then
      // truncate. Sub-tag breakdown runs after this so we only spend
      // /counts/posts.json calls on tags that survive the cut.
      const top10 = selectTopKByCount(preItems, 10);
      for (const obj of top10) delete obj._item;

      await this.attachSubTagBreakdowns(
        top10,
        tags,
        `user:${normalizedName}`,
        counts,
      );

      // Others = total user uploads − Σ top10.count. Clamped at 0 because
      // a single post can carry multiple characters, so Σtop10.count can
      // exceed N for variant-heavy uploaders (then Others is meaningless
      // and we omit the slice).
      const sumCount = top10.reduce(
        (acc: number, curr: {count: number}) => acc + curr.count,
        0,
      );
      const othersCount = Math.max(0, N - sumCount);

      if (othersCount > 0) {
        top10.push({
          name: 'Others',
          tagName: '',
          count: othersCount,
          frequency: 0,
          thumb: '',
          isOther: true,
        });
      }

      // Reuse unchanged thumbs before this write replaces the cache (L-2).
      await this.carryOverThumbs(cacheKey, uploaderId, top10);
      const shown = await this.cacheUnlessPartial(
        cacheKey,
        uploaderId,
        top10,
        counts.failed,
      );

      // Lazy Load Thumbnails
      await this.enrichThumbnails(
        cacheKey,
        uploaderId,
        shown,
        userInfo,
        reportSubStatus,
        !counts.failed,
      );

      return shown;
    } catch (e: unknown) {
      log.warn('Failed to fetch character distribution', {error: e});
      return [];
    }
  }

  /**
   * Fetches Copyright distribution from related_tag.json.
   * Filters out sub-copyrights by checking tag_implications.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array<{name: string, count: number, frequency: number, isOther: boolean}>>}
   */
  async getCopyrightDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus('Fetching Copyright Distribution...');
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'copyright_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const local = await this.getLocalDistributions(uploaderId);
    if (local) {
      return this.localTagDistribution(
        'copyright',
        userInfo,
        local,
        reportSubStatus,
      );
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    // limit=1000: see comment in getCharacterDistribution — needed so the
    // sub-tag breakdown's user-having signal isn't truncated at row 100.
    const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}&limit=1000`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
        return [];

      const tags: DanbooruRelatedTag[] = resp.related_tags;

      // Dynamic candidate pool — see getCharacterDistribution for the
      // rationale. Copy/fav caps lower (40) than character (80) because
      // copyright/franchise tags consolidate harder than character tags.
      const N = await this.getTotalPostCount(userInfo);
      const {filtered: filteredCap, raw: rawCap} = copyPoolSize(N);

      const rawCandidates: DanbooruRelatedTag[] = tags.slice(0, rawCap);

      const filteredCandidates = (
        await this.filterTopLevelCandidates(rawCandidates, userInfo)
      ).slice(0, filteredCap);

      // _item is a transient prop holding the source DanbooruRelatedTag so
      // we can fall back to its global post_count if the user-scoped count
      // query fails. It is `delete`d before the array is returned.
      const preItems: Array<
        DistributionItem & {_item?: DanbooruRelatedTag; tagName: string}
      > = filteredCandidates.map(item => ({
        name: item.tag.name.replace(/_/g, ' '),
        tagName: item.tag.name,
        count: 0,
        frequency: item.frequency,
        thumb: null,
        isOther: false,
        _item: item,
      }));

      await perfLogger.wrap(
        'dbi:db:refresh:mapConcurrent',
        () =>
          this.mapConcurrent(preItems, 6, async obj => {
            if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
            try {
              const c = await counts.lookup(
                `user:${normalizedName} ${obj.tagName}`,
              );
              obj.count = c || obj._item?.tag.post_count || 0;
            } catch (_e: unknown) {
              log.debug('Failed to fetch user tag count', {error: _e});
            }
          }),
        {distribution: 'copyright', n: preItems.length, concurrency: 6},
      );

      const top10 = selectTopKByCount(preItems, 10);
      for (const obj of top10) delete obj._item;

      await this.attachSubTagBreakdowns(
        top10,
        tags,
        `user:${normalizedName}`,
        counts,
      );

      // Others = total user uploads − Σ top10.count; see getCharacterDistribution.
      const sumCount = top10.reduce(
        (acc: number, curr: {count: number}) => acc + curr.count,
        0,
      );
      const othersCount = Math.max(0, N - sumCount);

      if (othersCount > 0) {
        top10.push({
          name: 'Others',
          tagName: '',
          count: othersCount,
          frequency: 0,
          thumb: '',
          isOther: true,
        });
      }

      // Reuse unchanged thumbs before this write replaces the cache (L-2).
      await this.carryOverThumbs(cacheKey, uploaderId, top10);
      const shown = await this.cacheUnlessPartial(
        cacheKey,
        uploaderId,
        top10,
        counts.failed,
      );

      // Lazy Load
      await this.enrichThumbnails(
        cacheKey,
        uploaderId,
        shown,
        userInfo,
        reportSubStatus,
        !counts.failed,
      );

      return shown;
    } catch (e: unknown) {
      log.warn('Failed to fetch copyright distribution', {error: e});
      return [];
    }
  }

  /**
   * Helper for concurrent processing with limit.
   * @param {Array} items Items to process.
   * @param {number} concurrency Max concurrent tasks.
   * @param {Function} fn Async function to run on each item.
   * @param {number} [delayMs=250] Delay between iterations per worker.
   * @return {Promise<Array>} Results array.
   */
  async mapConcurrent<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
    delayMs: number = 50,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;
    const next = async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i]);
        // Minimal stagger delay — RateLimitedFetch handles actual rate limiting
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      }
    };
    await Promise.all(Array.from({length: concurrency}, next));
    return results;
  }

  /**
   * The user's distributions counted from the local rows, or null when the
   * rows may not stand for Danbooru's counts (T-406). All of:
   *  - `sync_meta.fieldsVersion` ≥ 2: every row holds the tag fields;
   *  - no sync under way or left failed (`syncStartedAt` unset), and a
   *    completed sync on record;
   *  - the rows' numbering is intact (T-404) and there is at least one.
   * Otherwise the pies keep counting with `/counts/posts.json`.
   *
   * The counts come from the open's one scan of the rows (T-501), shared
   * with the summary, the scatter and the monthly chart; the result serves
   * the status, rating, character and copyright pies and the user stats
   * for {@link LOCAL_DISTRIBUTIONS_MEMO_MS} and is dropped whenever the
   * user's rows change (sync, backfill, catch-up, reset).
   */
  async getLocalDistributions(
    uploaderId: number,
  ): Promise<LocalDistributions | null> {
    if (!uploaderId) return null;
    const hit = this.localDistributionsMemo.get(uploaderId);
    if (hit && Date.now() - hit.at < LOCAL_DISTRIBUTIONS_MEMO_MS) {
      return hit.value;
    }
    const value = this.countLocalDistributions(uploaderId).catch(
      (e: unknown) => {
        log.warn('Local distributions failed, counting remotely', {error: e});
        return null;
      },
    );
    this.localDistributionsMemo.set(uploaderId, {at: Date.now(), value});
    return value;
  }

  private async countLocalDistributions(
    uploaderId: number,
  ): Promise<LocalDistributions | null> {
    const meta = await readSyncMeta(this.db, uploaderId);
    let notUsed: string | null = null;
    if ((meta?.fieldsVersion ?? 0) < POST_FIELDS_VERSION) {
      notUsed = 'fields version below 2';
    } else if (meta?.syncStartedAt !== undefined) {
      notUsed = 'a sync is under way or failed';
    } else if (meta?.needsFullSync) {
      notUsed = 'changes past the catch-up limit';
    } else if (
      !localStorage.getItem(`danbooru_grass_last_sync_${uploaderId}`)
    ) {
      notUsed = 'no completed sync';
    } else if (!(await this.rowNumberingIntact(uploaderId))) {
      notUsed = 'row numbering has a gap';
    }
    if (notUsed) {
      log.debug('Pies count remotely', {uploaderId, reason: notUsed});
      return null;
    }
    // Counted in the open's one scan of the rows (T-501).
    const {local} = await this.getRowSnapshot(uploaderId);
    return local.rows > 0 ? local : null;
  }

  /**
   * Drops what was read from the user's rows — the scan (T-501) and the
   * local pies — after they changed: a sync, a backfill, a catch-up that
   * changed rows, a reset.
   */
  private forgetLocalRows(uploaderId: number): void {
    this.localDistributionsMemo.delete(uploaderId);
    this.rowSnapshotMemo.delete(uploaderId);
  }

  /**
   * The character or copyright pie from local counts (T-406): the same
   * shape and cache key as the counted path, without `/related_tag.json`
   * or one count per candidate. Tags are ranked by their exact local count;
   * the top-level check (implication cache, {@link getTopLevelFlags}) walks
   * that order in batches until ten survive, and the sub-tag breakdown
   * reads the local counts too.
   */
  private async localTagDistribution(
    kind: 'character' | 'copyright',
    userInfo: TargetUser,
    local: LocalDistributions,
    reportSubStatus: ((msg: string) => void) | null,
  ): Promise<DistributionItem[]> {
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = kind === 'character' ? 'character_dist' : 'copyright_dist';
    const counts = kind === 'character' ? local.characters : local.copyrights;
    const ranked = [...counts].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );

    const top10: DistributionItem[] = [];
    for (
      let i = 0;
      i < ranked.length && i < LOCAL_TOP_LEVEL_SCAN_LIMIT && top10.length < 10;
      i += LOCAL_TOP_LEVEL_BATCH
    ) {
      const batch = ranked.slice(i, i + LOCAL_TOP_LEVEL_BATCH);
      const flags = await getTopLevelFlags(
        this.rateLimiter,
        this.db,
        batch.map(([tag]) => tag),
        uploaderId,
      );
      for (const [tag, count] of batch) {
        if (top10.length >= 10) break;
        if (flags.get(tag) === false) continue;
        top10.push({
          name: tag.replace(/_/g, ' '),
          tagName: tag,
          count,
          frequency: count / local.rows,
          thumb: null,
          isOther: false,
        });
      }
    }

    await this.attachSubTagBreakdownsFrom(
      top10,
      new Set(counts.keys()),
      async sub => counts.get(sub) ?? 0,
    );

    // Others = the user's posts − Σ top 10; see getCharacterDistribution.
    const sum = top10.reduce((acc, item) => acc + item.count, 0);
    const others = Math.max(0, local.rows - sum);
    if (others > 0) {
      top10.push({
        name: 'Others',
        tagName: '',
        count: others,
        frequency: 0,
        thumb: '',
        isOther: true,
      });
    }

    await this.carryOverThumbs(cacheKey, uploaderId, top10);
    const shown = await this.cacheUnlessPartial(
      cacheKey,
      uploaderId,
      top10,
      false,
    );
    await this.enrichThumbnails(
      cacheKey,
      uploaderId,
      shown,
      userInfo,
      reportSubStatus,
      true,
    );
    return shown;
  }

  /**
   * Mutates `top10` in place to attach `subTags` breakdown rows where the
   * user has sub-tag variants of a displayed parent. Pure data, no DOM —
   * the UI layer reads `DistributionItem.subTags` to render the legend
   * tooltip (v9.6.0+).
   *
   * Designed to be invoked concurrently with the per-tag count-fetch
   * loop in each distribution method (Copy / Fav_Copy / Char). Sub-tag
   * candidate fetch is batched and 180d-cached.
   *
   * Per-sub counts are fetched via `/counts/posts.json` with the caller's
   * `countQueryPrefix` (`user:NAME` for Copy/Char, `fav:NAME` for Fav_Copy
   * — the same prefix `getXDistribution` uses for the parent count). The
   * accurate count avoids the rounding drift that the previous
   * `frequency * resp.post_count` estimate produced (sub-tag totals could
   * sit several percent below the parent's own count for no visible
   * reason, because two different data sources were being mixed).
   */
  private async attachSubTagBreakdowns(
    top10: DistributionItem[],
    allUserTags: DanbooruRelatedTag[],
    countQueryPrefix: string,
    counts: CountBatch,
  ): Promise<void> {
    // Tags the user has at all (presence-only signal from /related_tag.json).
    // Drives which sub candidates are worth a per-sub count fetch — we never
    // spend a /counts/posts.json call on a sub the user has zero of.
    const userTagNames = new Set<string>();
    for (const item of allUserTags) {
      if (item.frequency > 0) userTagNames.add(item.tag.name);
    }
    await this.attachSubTagBreakdownsFrom(top10, userTagNames, sub =>
      counts.lookup(`${countQueryPrefix} ${sub}`),
    );
  }

  /**
   * {@link attachSubTagBreakdowns} given the tags the user has and how to
   * count one: `/counts/posts.json` there, the local rows' counts on the
   * local path (T-406).
   */
  private async attachSubTagBreakdownsFrom(
    top10: DistributionItem[],
    userTagNames: Set<string>,
    subCount: (sub: string) => Promise<number>,
  ): Promise<void> {
    const topLevelNames = top10
      .map(t => t.tagName)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (topLevelNames.length === 0) return;

    const subsByParent = await fetchSubTagsForParents(
      this.rateLimiter,
      this.db,
      topLevelNames,
    );

    const subsToFetch = new Set<string>();
    for (const subs of subsByParent.values()) {
      for (const sub of subs) {
        if (userTagNames.has(sub)) subsToFetch.add(sub);
      }
    }
    if (subsToFetch.size === 0) return;

    const userTagCounts = new Map<string, number>();
    await this.mapConcurrent([...subsToFetch], 5, async sub => {
      try {
        const c = await subCount(sub);
        if (c > 0) userTagCounts.set(sub, c);
      } catch (e: unknown) {
        log.debug('Failed to fetch sub-tag count', {sub, error: e});
      }
    });

    for (const item of top10) {
      if (!item.tagName) continue;
      const parentSubs = subsByParent.get(item.tagName);
      if (!parentSubs || parentSubs.size === 0) continue;
      const breakdown = applySubTagBreakdown(parentSubs, userTagCounts);
      if (breakdown.length > 0) item.subTags = breakdown;
    }
  }

  /**
   * Fetches Favorite Copyright distribution.
   * Uses ordfav:{user} to find favorites.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getFavCopyrightDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'fav_copyright_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    // limit=1000: see comment in getCharacterDistribution.
    const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=ordfav:${encodeURIComponent(normalizedName)}&limit=1000`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
        return [];

      const tags: DanbooruRelatedTag[] = resp.related_tags;

      // Dynamic candidate pool — same shape as getCopyrightDistribution.
      // N is the fav-owner's *upload* count; the fav-count itself isn't
      // strictly the right scale, but it's the only one we already have
      // cached and it's monotone-correlated with fav breadth in practice.
      const N = await this.getTotalPostCount(userInfo);
      const {filtered: filteredCap, raw: rawCap} = copyPoolSize(N);

      const rawCandidates: DanbooruRelatedTag[] = tags.slice(0, rawCap);

      // Implication data is a property of the tag name alone, so the fav tab
      // shares the same cached lookup as the user-scoped tabs.
      const filteredCandidates = (
        await this.filterTopLevelCandidates(rawCandidates, userInfo)
      ).slice(0, filteredCap);

      // _item is a transient prop, deleted before the array is returned.
      const preItems: Array<
        DistributionItem & {_item?: DanbooruRelatedTag; tagName: string}
      > = filteredCandidates.map(item => ({
        name: item.tag.name.replace(/_/g, ' '),
        tagName: item.tag.name,
        count: 0,
        frequency: item.frequency,
        thumb: null,
        isOther: false,
        _item: item,
      }));

      // Use fav: for counting (more standard), ordfav: for sorting/linking.
      // No post_count fallback here — fav-scoped count failures stay 0
      // and `selectTopKByCount` naturally ranks them last.
      await this.mapConcurrent(preItems, 6, async obj => {
        if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
        try {
          obj.count = await counts.lookup(
            `fav:${normalizedName} ${obj.tagName}`,
          );
        } catch (e: unknown) {
          log.warn('Count fetch failed for fav copyright tag', {
            tagName: obj.tagName,
            error: e,
          });
        }
      });

      const top10 = selectTopKByCount(preItems, 10);
      for (const obj of top10) delete obj._item;

      await this.attachSubTagBreakdowns(
        top10,
        tags,
        `fav:${normalizedName}`,
        counts,
      );

      // Others base = total favourite count (the fav set's size, not the
      // owner's upload count). One extra /counts/posts.json — negligible
      // next to the candidate-pool fetches. Multi-tag overlap clamp same
      // as character/copyright.
      let totalFavCount = 0;
      try {
        totalFavCount = await counts.lookup(`fav:${normalizedName}`);
      } catch (e: unknown) {
        log.debug('Failed to fetch total fav count', {error: e});
      }
      const sumCount = top10.reduce(
        (acc: number, curr: {count: number}) => acc + curr.count,
        0,
      );
      const othersCount = Math.max(0, totalFavCount - sumCount);

      if (othersCount > 0) {
        top10.push({
          name: 'Others',
          tagName: '',
          count: othersCount,
          frequency: 0,
          thumb: '',
          isOther: true,
        });
      }

      // Reuse unchanged thumbs before this write replaces the cache (L-2).
      await this.carryOverThumbs(cacheKey, uploaderId, top10);
      const shown = await this.cacheUnlessPartial(
        cacheKey,
        uploaderId,
        top10,
        counts.failed,
      );

      await this.enrichThumbnails(
        cacheKey,
        uploaderId,
        shown,
        userInfo,
        reportSubStatus,
        !counts.failed,
      );

      return shown;
    } catch (e: unknown) {
      log.warn('Failed to fetch fav copyright distribution', {error: e});
      return [];
    }
  }

  /**
   * Fetches top posts per rating (G/S/Q/E) in parallel using API.
   * Cached in piestats; refreshCriticalStats() passes forceRefresh=true so the
   * cache is populated on every sync and dashboard reads are free.
   * @param {!Object} userInfo The user's info object.
   * @param {boolean} forceRefresh Bypass cache and re-fetch.
   * @return {!Promise<{g: ?Object, s: ?Object, q: ?Object, e: ?Object}>} Top post per rating.
   */
  async getTopPostsByType(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
  ): Promise<{
    g: DanbooruPost | null;
    s: DanbooruPost | null;
    q: DanbooruPost | null;
    e: DanbooruPost | null;
  }> {
    if (!userInfo.name) return {g: null, s: null, q: null, e: null};

    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'top_posts_by_type';

    const cached = await this.tryGetCachedStats<{
      g: DanbooruPost | null;
      s: DanbooruPost | null;
      q: DanbooruPost | null;
      e: DanbooruPost | null;
    }>(cacheKey, uploaderId, forceRefresh);
    if (cached) return cached;

    // Helper for fetching 1 top post. An empty result is a real "none";
    // a non-OK reply or a throw marks the run failed (see cacheUnlessPartial).
    let failed = false;
    const fetchTop = async (
      ratingTag: string,
      extraQuery: string = '',
    ): Promise<DanbooruPost | null> => {
      try {
        // Use tags=... order:score rating:x status:active limit=1
        // status:active excludes banned/deleted posts that would render as a
        // blank thumbnail cell.
        const normalizedName = userInfo.name.replace(/ /g, '_');
        const query = `user:${normalizedName} order:score rating:${ratingTag} status:active ${extraQuery}`;
        const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,media_asset[variants],rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
        const r = await this.rateLimiter.fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const resp = await r.json();
        if (Array.isArray(resp) && resp.length > 0) {
          return resp[0];
        }
      } catch (e: unknown) {
        log.warn('Failed to fetch top post for rating', {ratingTag, error: e});
        failed = true;
      }
      return null;
    };

    const [g, s, q, e] = await Promise.all([
      fetchTop('g'),
      fetchTop('s'),
      fetchTop('q'),
      fetchTop('e'),
    ]);

    return this.cacheUnlessPartial(cacheKey, uploaderId, {g, s, q, e}, failed);
  }

  /**
   * Fetches Recent Popular (age < 1w) posts for SFW and NSFW in parallel.
   * Cached in piestats; refreshCriticalStats() passes forceRefresh=true so the
   * cache is populated on every sync and dashboard reads are free.
   * @param {!Object} userInfo The user's info object.
   * @param {boolean} forceRefresh Bypass cache and re-fetch.
   * @return {!Promise<{sfw: ?Object, nsfw: ?Object}>} Recent popular post per SFW/NSFW.
   */
  async getRecentPopularPosts(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
  ): Promise<{sfw: DanbooruPost | null; nsfw: DanbooruPost | null}> {
    if (!userInfo.name) return {sfw: null, nsfw: null};

    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'recent_popular_posts';

    const cached = await this.tryGetCachedStats<{
      sfw: DanbooruPost | null;
      nsfw: DanbooruPost | null;
    }>(cacheKey, uploaderId, forceRefresh);
    if (cached) return cached;

    let failed = false; // see cacheUnlessPartial
    const fetchTop = async (
      ratingTag: string,
    ): Promise<DanbooruPost | null> => {
      try {
        const normalizedName = userInfo.name.replace(/ /g, '_');
        // status:active excludes banned/deleted posts that would render as a
        // blank thumbnail cell.
        const query = `user:${normalizedName} order:score ${ratingTag} age:<1w status:active`;
        const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,media_asset[variants],rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
        const r = await this.rateLimiter.fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const resp = await r.json();
        if (Array.isArray(resp) && resp.length > 0) {
          return resp[0];
        }
      } catch (e: unknown) {
        log.warn('Failed to fetch recent top post', {ratingTag, error: e});
        failed = true;
      }
      return null;
    };

    const [sfw, nsfw] = await Promise.all([
      fetchTop('is:sfw'),
      fetchTop('is:nsfw'),
    ]);

    return this.cacheUnlessPartial(cacheKey, uploaderId, {sfw, nsfw}, failed);
  }

  /**
   * Fetches a user's most-recent uploads for the preview popover grid as
   * lightweight PostPreview view-models. Real-time: no DB storage, no cache.
   * Two parallel requests — recent posts (`status:any` so deleted/pending/
   * flagged are included) and the user's appealed post ids (`status:appealed`
   * has no per-post API flag, so it is resolved separately).
   * @param {!TargetUser} userInfo The user to fetch for.
   * @param {number} limit Max posts to return (default 20).
   * @return {!Promise<!Array<PostPreview>>} Newest-first previews; [] on error.
   */
  async getRecentPostsPreview(
    userInfo: TargetUser,
    limit = 20,
  ): Promise<PostPreview[]> {
    if (!userInfo.name) return [];
    const normalizedName = userInfo.name.replace(/ /g, '_');
    const {postsUrl, appealedUrl} = buildPreviewPostUrls(normalizedName, limit);
    // Mintag (uploader tag-laziness) needs the upload versions' added_tags;
    // id-based, so skip it when the numeric id is missing — the grid still
    // renders, those posts just stay unflagged (fail-open).
    const versionsUrl = userInfo.id
      ? buildMintagVersionsUrl(userInfo.id, limit)
      : null;

    try {
      const [posts, appealed, versions] = await Promise.all([
        this.rateLimiter.fetch(postsUrl).then(r => r.json()),
        this.rateLimiter
          .fetch(appealedUrl)
          .then(r => r.json())
          .catch(() => []),
        versionsUrl
          ? this.rateLimiter
              .fetch(versionsUrl)
              .then(r => r.json())
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      if (!Array.isArray(posts)) return [];
      const appealedIds = new Set<number>(
        (Array.isArray(appealed) ? appealed : []).map(
          (p: DanbooruPost) => p.id,
        ),
      );
      const tagCounts = buildUploaderTagCounts(
        Array.isArray(versions) ? versions : [],
      );
      return posts.map((p: DanbooruPost) => ({
        ...toPostPreview(p, appealedIds),
        uploaderTagCount: tagCounts.get(p.id),
      }));
    } catch (e: unknown) {
      log.warn('Failed to fetch recent posts preview', {
        user: userInfo.name,
        error: e,
      });
      return [];
    }
  }

  /**
   * The user's most recent uploads as {@link WindowPoint}s for the "At a
   * glance" pane — one `/posts.json` request, cached in piestats under
   * `recent_window` with the count-cache TTL. A failed or empty fetch returns
   * `[]` and is not cached; the caller falls back to the local window.
   * @param {!TargetUser} userInfo The user to fetch for.
   * @param {number} limit How many recent uploads (default 200).
   * @param {boolean} forceRefresh Bypass the cache (SWR revalidate).
   * @return {!Promise<!Array<!WindowPoint>>} Newest-first points.
   */
  async getRecentUploadWindow(
    userInfo: TargetUser,
    limit = WINDOW_SIZE,
    forceRefresh = false,
  ): Promise<WindowPoint[]> {
    if (!userInfo.name) return [];
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'recent_window';
    const cached = await this.tryGetCachedStats<WindowPoint[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    try {
      const posts = await this.rateLimiter
        .fetch(buildRecentWindowUrl(normalizedName, limit))
        .then(r => r.json());
      if (!Array.isArray(posts) || !posts.length) return [];
      const points = posts.map((p: DanbooruPost) =>
        danbooruPostToWindowPoint(p),
      );
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, points);
      return points;
    } catch (e: unknown) {
      log.warn('Failed to fetch recent upload window', {
        user: userInfo.name,
        error: e,
      });
      return [];
    }
  }

  /**
   * Of the given (mintagged) post ids, returns those that look "abandoned":
   * their v2 landed at least {@link ABANDONED_GAP_MS} after v1, i.e. the
   * upload sat under-tagged before someone else stepped in (vs. the
   * competitive-tagging race, where v2 follows v1 almost immediately).
   *
   * One {@link buildPostVersionsUrl} request per id, run with
   * {@link mapConcurrent}; per-post failures degrade to "not abandoned"
   * (fail-open). Called as a background pass after the grid renders, so the
   * red escalation pops in without blocking section A.
   * @param {!Array<number>} postIds Mintagged post ids to inspect.
   * @return {!Promise<!Set<number>>} The subset whose v1→v2 gap is abandoned.
   */
  async getAbandonedPostIds(postIds: number[]): Promise<Set<number>> {
    if (!postIds.length) return new Set();
    const flags = await this.mapConcurrent(
      postIds,
      6,
      async (postId: number) => {
        try {
          const rows = await this.rateLimiter
            .fetch(buildPostVersionsUrl(postId))
            .then(r => r.json());
          return Array.isArray(rows) && isAbandonedByGap(rows) ? postId : null;
        } catch (e: unknown) {
          log.warn('Abandoned-gap lookup failed', {postId, error: e});
          return null;
        }
      },
    );
    return new Set(flags.filter((id): id is number => id !== null));
  }

  /**
   * Fetches the user's most-recent activity across 11 feed types (post upload
   * + tag edit + note/wiki/artist/commentary/pool version edits +
   * forum/approval/comment/appeal) for the preview popover's distribution
   * strip. Each type is one `limit&only=ts` request, run with
   * {@link mapConcurrent}; the merged feed keeps the most-recent `limit`
   * segments. Real-time: no DB storage, no cache (the ui popover applies its
   * own 60s cache + in-flight dedupe).
   *
   * Requires the numeric `userInfo.id` — every search param here is id-based
   * (`updater_id`/`creator_id`/`user_id`); returns an empty distribution if
   * it is missing. Per-type failures degrade gracefully to no segments.
   *
   * Commentary is filtered: a post uploaded *with* commentary auto-creates a
   * v1 ArtistCommentaryVersion in the same transaction, which would
   * double-count the upload as commentary work. Those upload-coupled v1s are
   * dropped via {@link filterUploadCoupledCommentary} after looking up the
   * relevant posts' upload times.
   * @param {!TargetUser} userInfo The user to fetch for.
   * @param {number} limit Max segments in the merged feed (default 100).
   * @return {!Promise<!ActivityDistribution>} Merged feed + per-type counts.
   */
  async getActivityDistribution(
    userInfo: TargetUser,
    limit = 100,
  ): Promise<ActivityDistribution> {
    const userId = userInfo.id;
    if (!userId) return mergeRecentActivity([], limit);

    // post_versions is split by `is_new`: the version created at upload
    // (`upload`) vs. later tag/metadata edits (`edit`). Two requests, since
    // `search[is_new]` filters server-side (per the post_versions search UI).
    const v = (type: ActivityType, endpoint: string, extra?: string) => ({
      type,
      endpoint,
      param: 'updater_id',
      extra,
    });
    const descriptors: ActivityDescriptor[] = [
      v('upload', '/post_versions.json', 'search[is_new]=true'),
      v('edit', '/post_versions.json', 'search[is_new]=false'),
      v('note', '/note_versions.json'),
      v('wiki', '/wiki_page_versions.json'),
      v('artist', '/artist_versions.json'),
      v('commentary', '/artist_commentary_versions.json'),
      v('pool', '/pool_versions.json'),
      {type: 'forum', endpoint: '/forum_posts.json', param: 'creator_id'},
      {type: 'approval', endpoint: '/post_approvals.json', param: 'user_id'},
      {type: 'comment', endpoint: '/comments.json', param: 'creator_id'},
      {type: 'appeal', endpoint: '/post_appeals.json', param: 'creator_id'},
    ];

    const perType = await this.mapConcurrent(descriptors, 6, async d => {
      if (d.type === 'upload')
        return this.fetchUploadActivity(d, userId, limit);
      if (d.type === 'commentary') {
        return this.fetchCommentaryActivity(d, userId, limit);
      }
      if (d.type === 'comment') {
        return this.fetchCommentActivity(d, userId, limit);
      }
      return this.fetchActivityType(d, userId, limit);
    });
    return mergeRecentActivity(perType, limit);
  }

  /**
   * Upload activity (post_versions, is_new=true) → segments retyped to
   * `suspicious` when the post is deleted, flagged, carries a suspicious tag
   * (`SUSPICIOUS_UPLOAD_TAGS`) or is heavily downvoted (one
   * batch {@link fetchPostBadnessMeta} lookup over the segments' post ids).
   * See {@link classifyUploadType}. Suspicious segments keep their `postId`
   * so the legend can link straight to the flagged posts.
   */
  private async fetchUploadActivity(
    d: ActivityDescriptor,
    userId: string,
    limit: number,
  ): Promise<ActivitySegment[]> {
    try {
      const url =
        `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}` +
        `${d.extra ? `&${d.extra}` : ''}&limit=${limit}` +
        '&only=id,post_id,updated_at,created_at';
      const rows = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!Array.isArray(rows)) return [];
      const segs = rows.map(
        (r: {post_id?: number; updated_at?: string; created_at?: string}) => ({
          postId: r.post_id ?? -1,
          ts: Date.parse(r.updated_at ?? r.created_at ?? ''),
        }),
      );
      const meta = await this.fetchPostBadnessMeta(segs.map(s => s.postId));
      return segs.map(s => {
        const type = classifyUploadType(meta.get(s.postId));
        // upload → gallery #post_<postId>; suspicious carries postId for the
        // id: list (its anchor is derived from suspiciousPostIds instead).
        return type === 'suspicious'
          ? {type, ts: s.ts, postId: s.postId}
          : {type, ts: s.ts, anchorId: s.postId};
      });
    } catch (e: unknown) {
      log.warn('Activity feed fetch failed', {type: 'upload', error: e});
      return [];
    }
  }

  /**
   * Comment activity → segments retyped to `suspicious` when the comment is
   * heavily downvoted (see {@link classifyCommentType}). Fetches `score` and
   * `post_id` alongside the timestamp; a suspicious comment keeps the id of
   * the post it sits on so the legend's link can surface that post.
   */
  private async fetchCommentActivity(
    d: ActivityDescriptor,
    userId: string,
    limit: number,
  ): Promise<ActivitySegment[]> {
    try {
      const url =
        `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}` +
        `&limit=${limit}&only=id,post_id,score,created_at`;
      const rows = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!Array.isArray(rows)) return [];
      return rows.map(
        (r: {
          id?: number;
          post_id?: number;
          score?: number;
          created_at?: string;
        }) => {
          const type = classifyCommentType(r.score);
          const ts = Date.parse(r.created_at ?? '');
          // suspicious → postId for the id: list (gallery anchor); a normal
          // comment → anchorId = comment id for `#comment_<id>` on /comments.
          return type === 'suspicious' && r.post_id
            ? {type, ts, postId: r.post_id}
            : {type, ts, anchorId: r.id};
        },
      );
    } catch (e: unknown) {
      log.warn('Activity feed fetch failed', {type: 'comment', error: e});
      return [];
    }
  }

  /**
   * Maps post ids → {@link UploadMeta} (deleted/flagged/score/tags) in one
   * `status:any` batch query so deleted uploads still resolve.
   * `tag_string_meta` rides along so the suspicious-tag check needs no second
   * request (all `SUSPICIOUS_UPLOAD_TAGS` are Meta-category). Capped at the
   * `/posts.json` limit (200); misses leave a segment unflagged (fail-open).
   */
  private async fetchPostBadnessMeta(
    postIds: number[],
  ): Promise<Map<number, UploadMeta>> {
    const unique = [...new Set(postIds.filter(id => id > 0))].slice(0, 200);
    const map = new Map<number, UploadMeta>();
    if (unique.length === 0) return map;
    try {
      const query = `id:${unique.join(',')} status:any`;
      const url =
        `/posts.json?tags=${encodeURIComponent(query)}` +
        `&limit=${unique.length}` +
        '&only=id,is_deleted,is_flagged,score,tag_string_meta';
      const rows = await this.rateLimiter.fetch(url).then(r => r.json());
      if (Array.isArray(rows)) {
        for (const p of rows as Array<{
          id?: number;
          is_deleted?: boolean;
          is_flagged?: boolean;
          score?: number;
          tag_string_meta?: string;
        }>) {
          if (p.id !== undefined) {
            map.set(p.id, {
              isDeleted: !!p.is_deleted,
              isFlagged: !!p.is_flagged,
              score: p.score,
              metaTags: p.tag_string_meta,
            });
          }
        }
      }
    } catch (e: unknown) {
      log.warn('Post badness lookup failed', {count: unique.length, error: e});
    }
    return map;
  }

  /**
   * Fetches one activity feed type as `{type, ts}` segments. `ts` prefers
   * `updated_at` (merge-window edits land on the latest touch) and falls back
   * to `created_at`. `extra` appends an extra search clause (e.g.
   * `search[is_new]=false`). Returns `[]` on any failure so one dead endpoint
   * never sinks the whole strip.
   */
  private async fetchActivityType(
    d: ActivityDescriptor,
    userId: string,
    limit: number,
  ): Promise<ActivitySegment[]> {
    try {
      const url =
        `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}` +
        `${d.extra ? `&${d.extra}` : ''}&limit=${limit}` +
        '&only=id,updated_at,created_at';
      const rows = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!Array.isArray(rows)) return [];
      return rows.map(
        (r: {id?: number; updated_at?: string; created_at?: string}) => ({
          type: d.type,
          ts: Date.parse(r.updated_at ?? r.created_at ?? ''),
          anchorId: r.id, // native record id → `#<prefix>_<id>` scroll target
        }),
      );
    } catch (e: unknown) {
      log.warn('Activity feed fetch failed', {type: d.type, error: e});
      return [];
    }
  }

  /**
   * Like {@link fetchActivityType} but for commentary: keeps each segment's
   * `post_id`, looks up those posts' upload times, and drops the
   * upload-coupled v1 commentary versions (see
   * {@link filterUploadCoupledCommentary}).
   */
  private async fetchCommentaryActivity(
    d: ActivityDescriptor,
    userId: string,
    limit: number,
  ): Promise<ActivitySegment[]> {
    try {
      const url =
        `${d.endpoint}?search[${d.param}]=${encodeURIComponent(userId)}` +
        `&limit=${limit}&only=id,post_id,updated_at,created_at`;
      const rows = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!Array.isArray(rows)) return [];
      const segments: CommentarySegment[] = rows.map(
        (r: {
          id?: number;
          post_id?: number;
          updated_at?: string;
          created_at?: string;
        }) => ({
          type: 'commentary',
          postId: r.post_id ?? -1,
          ts: Date.parse(r.updated_at ?? r.created_at ?? ''),
          anchorId: r.id, // commentary version id → #artist_commentary_version_<id>
        }),
      );
      const uploadTimes = await this.fetchPostUploadTimes(
        segments.map(s => s.postId),
      );
      return filterUploadCoupledCommentary(segments, uploadTimes);
    } catch (e: unknown) {
      log.warn('Activity feed fetch failed', {type: 'commentary', error: e});
      return [];
    }
  }

  /**
   * Maps post ids → upload time (epoch ms, from `created_at`) in one
   * `status:any` batch query (`id:` comma list so deleted uploads still
   * resolve). Used to detect upload-coupled commentary. Capped at the
   * `/posts.json` limit (200); any commentary beyond that is simply kept
   * (fail-open). Returns an empty map on no ids or failure.
   */
  private async fetchPostUploadTimes(
    postIds: number[],
  ): Promise<Map<number, number>> {
    const unique = [...new Set(postIds.filter(id => id > 0))].slice(0, 200);
    const map = new Map<number, number>();
    if (unique.length === 0) return map;
    try {
      const query = `id:${unique.join(',')} status:any`;
      const url =
        `/posts.json?tags=${encodeURIComponent(query)}` +
        `&limit=${unique.length}&only=id,created_at`;
      const rows = await this.rateLimiter.fetch(url).then(r => r.json());
      if (Array.isArray(rows)) {
        for (const p of rows as Array<{id?: number; created_at?: string}>) {
          const ts = Date.parse(p.created_at ?? '');
          if (p.id !== undefined && Number.isFinite(ts)) map.set(p.id, ts);
        }
      }
    } catch (e: unknown) {
      log.warn('Post upload-time lookup failed', {
        count: unique.length,
        error: e,
      });
    }
    return map;
  }

  /**
   * Fetches Random posts for SFW and NSFW in parallel.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<{sfw: ?Object, nsfw: ?Object}>} Random post per SFW/NSFW.
   */
  async getRandomPosts(
    userInfo: TargetUser,
  ): Promise<{sfw: DanbooruPost | null; nsfw: DanbooruPost | null}> {
    if (!userInfo.name) return {sfw: null, nsfw: null};

    const fetchRandom = async (
      ratingTag: string,
    ): Promise<DanbooruPost | null> => {
      try {
        const normalizedName = userInfo.name.replace(/ /g, '_');
        // status:active excludes banned/deleted posts — without it, random
        // could land on a banned post and render an empty card (user report).
        const query = `user:${normalizedName} ${ratingTag} status:active`;
        const url = `/posts/random.json?tags=${encodeURIComponent(query)}&only=id,preview_file_url,file_url,media_asset[variants],rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        if (resp && resp.id) {
          return resp;
        }
      } catch (e: unknown) {
        log.warn('Failed to fetch random post', {ratingTag, error: e});
      }
      return null;
    };

    const [sfw, nsfw] = await Promise.all([
      fetchRandom('is:sfw'),
      fetchRandom('is:nsfw'),
    ]);

    return {sfw, nsfw};
  }

  /**
   * Fetches data for Scatter Plot.
   * Returns minimal object array to save memory/time.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<Array<{id: number, d: number, s: number, t: number, r: string}>>}
   */
  async getScatterData(userInfo: TargetUser): Promise<ScatterDataPoint[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];
    // A copy of the open's one scan (T-501): the scatter replaces its own
    // array in place after a backfill (replaceArrayContents).
    return (await this.getRowSnapshot(uploaderId)).points.slice();
  }

  /**
   * The user's rows read once for the dashboard (T-501): the summary, the
   * monthly chart, the scatter and the local pies all derive from it, so an
   * open reads `posts` once instead of four times. Kept for
   * {@link ROW_SNAPSHOT_MEMO_MS} and dropped when the rows change
   * ({@link forgetLocalRows}); a failed read is not kept.
   */
  private getRowSnapshot(uploaderId: number): Promise<RowSnapshot> {
    const hit = this.rowSnapshotMemo.get(uploaderId);
    if (hit && Date.now() - hit.at < ROW_SNAPSHOT_MEMO_MS) return hit.value;
    const entry = {at: Date.now(), value: this.scanRows(uploaderId)};
    this.rowSnapshotMemo.set(uploaderId, entry);
    const drop = () => {
      if (this.rowSnapshotMemo.get(uploaderId) === entry) {
        this.rowSnapshotMemo.delete(uploaderId);
      }
    };
    void entry.value.catch(drop);
    // Let the memory go once expired: the app's own manager lives as long
    // as the page. (A timer that runs early, as test stubs do, keeps it.)
    setTimeout(() => {
      if (Date.now() - entry.at >= ROW_SNAPSHOT_MEMO_MS) drop();
    }, ROW_SNAPSHOT_MEMO_MS);
    return entry.value;
  }

  /** One pass over the user's rows: {@link RowSnapshot}. */
  private async scanRows(uploaderId: number): Promise<RowSnapshot> {
    const points: ScatterDataPoint[] = [];
    const days: string[] = [];
    const counter = createLocalDistributionCounter();
    await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .each((row: PostRecord) => {
        counter.add(row);
        if (!row.created_at) return;
        points.push({
          id: row.id,
          // Timestamps plot faster than date strings.
          d: new Date(row.created_at).getTime(),
          s: row.score || 0,
          t: row.tag_count_general || 0,
          r: row.rating,
          dn: row.down_score,
          del: row.is_deleted,
          ban: row.is_banned,
        });
        days.push(row.created_at.split('T')[0]);
      });
    return {points, days, local: counter.result()};
  }

  /**
   * Reads the persisted backfill failure state for a user. Returns null if
   * absent or unparseable. Localized I/O wrapper around the storage key
   * defined in {@link backfillFailureStorageKey}.
   */
  private getBackfillFailureState(
    uploaderId: number,
  ): BackfillFailureState | null {
    const raw = localStorage.getItem(backfillFailureStorageKey(uploaderId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as BackfillFailureState;
    } catch {
      return null;
    }
  }

  /** Persists the backfill failure state for a user. */
  private setBackfillFailureState(
    uploaderId: number,
    state: BackfillFailureState,
  ): void {
    localStorage.setItem(
      backfillFailureStorageKey(uploaderId),
      JSON.stringify(state),
    );
  }

  /** Removes any persisted backfill failure state for a user. */
  private clearBackfillFailureState(uploaderId: number): void {
    localStorage.removeItem(backfillFailureStorageKey(uploaderId));
  }

  /**
   * Records one more backfill failure and emits a console warning so devs
   * can spot infinite-retry loops in dev tools.
   */
  private recordBackfillFailure(uploaderId: number): void {
    const next = recordFailure(this.getBackfillFailureState(uploaderId));
    this.setBackfillFailureState(uploaderId, next);
    log.warn('Backfill failure recorded', {
      uploaderId,
      failureCount: next.failureCount,
      threshold: BACKFILL_FAILURE_THRESHOLD,
    });
  }

  /**
   * Whether to run {@link backfillPostMetadata} now: the user has rows but
   * `sync_meta` does not say they hold fields version 2 (T-403), and the
   * backfill is not in failure cooldown.
   *
   * Version 2 includes the v9.x metadata (down_score / is_deleted /
   * is_banned) this backfill was first written for, so the old
   * `di_post_metadata_v2_*` flag and its row scan are no longer read.
   *
   * The cooldown gate lives here (rather than inside `backfillPostMetadata`)
   * so that the scatter widget never sees `needsBackfill: true` during
   * cooldown — avoids the brief 'updating…' label flicker that would
   * otherwise appear if the backfill function returned immediately.
   */
  async needsPostMetadataBackfill(userInfo: TargetUser): Promise<boolean> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return false;

    const meta = await readSyncMeta(this.db, uploaderId);
    if ((meta?.fieldsVersion ?? 0) >= POST_FIELDS_VERSION) return false;

    if (isBackfillInCooldown(this.getBackfillFailureState(uploaderId))) {
      return false;
    }

    const rows = await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .count();
    return rows > 0;
  }

  /**
   * Brings a user's rows to fields version 2 (T-403). Every row the user
   * had when the backfill started is fetched again — the tag fields and
   * the metadata alike, with the sync's `only=` — and rebuilt by
   * `toPostRecord` under its own `no`, so the numbering stays.
   *
   * Not only the rows that lack the fields: the change watermark recorded
   * at the end is the server time of the backfill's first response, so
   * every row must have been fetched after it (a row a resume sync wrote
   * earlier would otherwise miss the changes in between).
   *
   * The rows' id span is cut into {@link BACKFILL_RANGES} ranges walked in
   * parallel, each in id order (`id:a..b order:id`, 2 search terms: fine
   * for a logged-out viewer). The plan and each range's progress are kept
   * in `sync_meta.backfill`, so an interrupted run resumes where it stopped
   * with the same watermark. Rows a sync adds meanwhile fall outside the
   * ranges and need nothing: the sync wrote them with version 2, after it.
   *
   * Failures: an HTTP error (except 429) or a network error counts toward
   * the cooldown; a 429 only stops this run (the rate limiter is already
   * pausing). The dashboard keeps counting meanwhile (T-406 waits for
   * version 2).
   *
   * @param userInfo Target user
   * @param onProgress Optional progress callback (current, total)
   */
  async backfillPostMetadata(
    userInfo: TargetUser,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return;

    const meta = await readSyncMeta(this.db, uploaderId);
    if ((meta?.fieldsVersion ?? 0) >= POST_FIELDS_VERSION) return;

    const rows: PostRecord[] = await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .toArray();
    if (rows.length === 0) return;

    const ids = rows.map(r => r.id).sort((a, b) => a - b);
    const run: BackfillRun = {
      from: meta?.backfill?.from,
      ranges: (
        meta?.backfill?.ranges ?? splitIdRanges(ids, BACKFILL_RANGES)
      ).map(r => ({...r})),
      failed: false,
      failureRecorded: false,
      done: 0,
      byId: new Map(rows.map(r => [r.id, r])),
      total: 0,
    };
    run.total = ids.filter(id =>
      run.ranges.some(r => id > r.after && id <= r.to),
    ).length;
    if (onProgress) onProgress(0, run.total);

    await Promise.all(
      run.ranges.map(range =>
        this.backfillRange(userInfo, uploaderId, range, run, onProgress),
      ),
    );
    if (run.failed) return;

    await patchSyncMeta(this.db, uploaderId, {
      fieldsVersion: POST_FIELDS_VERSION,
      changeWatermark: run.from ?? Date.now(),
      timeZone: viewerTimeZone(),
      backfill: undefined,
      catchUp: undefined,
      needsFullSync: undefined,
    });
    // Full success: any earlier failure history is stale.
    this.clearBackfillFailureState(uploaderId);
    this.forgetLocalRows(uploaderId);
  }

  /**
   * Walks one id range of a {@link backfillPostMetadata} run to its end,
   * saving the run's progress after every page. Stops when the run has
   * failed elsewhere.
   */
  private async backfillRange(
    userInfo: TargetUser,
    uploaderId: number,
    range: {after: number; to: number},
    run: BackfillRun,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    const name = userInfo.name.replace(/ /g, '_');
    const limit = 200;
    while (!run.failed && range.after < range.to) {
      const params = new URLSearchParams({
        tags: `user:${name} status:any id:${range.after + 1}..${range.to} order:id`,
        limit: String(limit),
        only: SYNC_POST_FIELDS,
      });
      const batch = await this.fetchBackfillPage(
        `/posts.json?${params.toString()}`,
        uploaderId,
        run,
      );
      if (!batch) {
        run.failed = true;
        return;
      }

      const updates: PostRecord[] = [];
      for (const p of batch) {
        const existing = run.byId.get(p.id);
        // A post the rows lack is the sync's to add, not ours.
        if (existing) updates.push(toPostRecord(p, existing.no));
      }
      if (updates.length > 0) {
        await bulkPutSafe(this.db.posts, updates, () =>
          evictOldestNonCurrentUser(this.db, uploaderId),
        );
        run.done += updates.length;
        if (onProgress) onProgress(run.done, run.total);
      }

      range.after =
        batch.length < limit ? range.to : batch[batch.length - 1].id;
      await patchSyncMeta(this.db, uploaderId, {
        backfill: {from: run.from ?? Date.now(), ranges: run.ranges},
      });
    }
  }

  /**
   * One backfill page, or null when the run must stop (the failure is
   * recorded for the cooldown, except a 429). The first response fixes
   * the run's watermark (`run.from`) if a resumed plan has none.
   */
  private async fetchBackfillPage(
    url: string,
    uploaderId: number,
    run: BackfillRun,
  ): Promise<DanbooruPost[] | null> {
    try {
      const resp = await this.rateLimiter.fetch(url);
      if (!resp.ok) {
        if (shouldCountHttpAsFailure(resp.status)) {
          log.warn('Backfill HTTP error — pausing backfill', {
            status: resp.status,
            url,
          });
          this.recordBackfillRunFailure(run, uploaderId);
        } else {
          // 429: the rate limiter is already pausing; not our failure.
          log.warn('Backfill HTTP 429 — stopping this run');
        }
        return null;
      }
      run.from ??= responseServerTime(resp, Date.now());
      const batch: unknown = await resp.json();
      if (!Array.isArray(batch)) throw new Error('Backfill page is not a list');
      return batch as DanbooruPost[];
    } catch (e) {
      // Network or parse failure: rarely transient at page-load scale, and
      // the cooldown gives 24 h before the next try.
      log.warn('Backfill fetch failed', {error: e, url});
      this.recordBackfillRunFailure(run, uploaderId);
      return null;
    }
  }

  /**
   * Counts a failed run toward the cooldown once, however many of its
   * parallel ranges fail. The cooldown means three failed runs; the
   * ranges' requests are in flight together and tend to fail together,
   * so counting each one could put a single bad moment straight into 24 h
   * of cooldown (a browser check on 2026-11-15 found an account already in
   * cooldown on the build's first day).
   */
  private recordBackfillRunFailure(run: BackfillRun, uploaderId: number): void {
    if (run.failureRecorded) return;
    run.failureRecorded = true;
    this.recordBackfillFailure(uploaderId);
  }

  /**
   * Brings the user's rows up to date with the posts changed on Danbooru
   * since the last sync or catch-up (T-407, decision G-2): reads
   * `user:X order:change` (2 search terms), 200 at a time with the sync's
   * fields, and overwrites the rows it has, each under its own `no`. Posts
   * the rows lack are left to the sync. The walk's decisions — where to
   * stop, how to resume — are in `core/change-catch-up.ts`; progress is
   * saved in `sync_meta.catchUp` after every tail page.
   *
   * Runs only for rows of fields version 2 with a watermark, outside a
   * sync, and once per count TTL (`caughtUpAt`). Usually one request. A
   * walk past the page limit marks `needsFullSync`: the pies count remotely
   * and the next sync starts over.
   *
   * @return How many rows were overwritten (0 when it did not run).
   */
  async catchUpChanges(userInfo: TargetUser): Promise<{changed: number}> {
    const uploaderId = parseInt(userInfo.id || '0');
    if (!uploaderId || !userInfo.name) return {changed: 0};
    if (AnalyticsDataManager.isGlobalSyncing) return {changed: 0};

    const meta = await readSyncMeta(this.db, uploaderId);
    const watermark = catchUpWatermark(meta, Date.now(), getCountCacheTtlMs());
    if (watermark === null) return {changed: 0};

    const name = userInfo.name.replace(/ /g, '_');
    let cursor: CatchUpCursor | null = startCatchUp(watermark, meta?.catchUp);
    let changed = 0;
    while (cursor) {
      const batch = await this.fetchChangePage(name, cursor.page);
      if (!batch) break; // Saved progress stays: the next open resumes.
      changed += await this.applyChangedPosts(uploaderId, batch);
      const step = afterCatchUpPage(
        cursor,
        watermark,
        batch.map(p => Date.parse(p.updated_at ?? '')).filter(t => !isNaN(t)),
        CATCH_UP_PAGE_LIMIT,
        SYNC_SEGMENT_PAGES,
      );
      cursor = await this.recordCatchUpStep(uploaderId, step, watermark);
    }
    if (changed > 0) this.forgetLocalRows(uploaderId);
    return {changed};
  }

  /**
   * Saves what a catch-up step means in `sync_meta` and gives the next
   * cursor, or null when the walk is over: done (new watermark, the time
   * of completion), past the page limit (`needsFullSync`), or a tail page
   * read (progress saved; the head phase saves nothing).
   */
  private async recordCatchUpStep(
    uploaderId: number,
    step: CatchUpStep,
    watermark: number,
  ): Promise<CatchUpCursor | null> {
    if (step.kind === 'overflow') {
      log.warn('Change catch-up past the page limit, full sync needed', {
        uploaderId,
      });
      await patchSyncMeta(this.db, uploaderId, {
        needsFullSync: true,
        catchUp: undefined,
      });
      return null;
    }
    if (step.kind === 'done') {
      await patchSyncMeta(this.db, uploaderId, {
        changeWatermark: step.watermark,
        catchUp: undefined,
        caughtUpAt: Date.now(),
      });
      return null;
    }
    const cursor = step.cursor;
    if (cursor.phase === 'tail') {
      await patchSyncMeta(this.db, uploaderId, {
        catchUp: {page: cursor.page, headAt: cursor.headAt ?? watermark},
      });
    }
    return cursor;
  }

  /** One `order:change` page of the user's posts, or null on a failure. */
  private async fetchChangePage(
    name: string,
    page: number,
  ): Promise<DanbooruPost[] | null> {
    const params = new URLSearchParams({
      tags: `user:${name} order:change`,
      limit: String(CATCH_UP_PAGE_LIMIT),
      page: String(page),
      only: SYNC_POST_FIELDS,
    });
    try {
      const resp = await this.rateLimiter.fetch(
        `/posts.json?${params.toString()}`,
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const batch: unknown = await resp.json();
      if (!Array.isArray(batch)) throw new Error('Change page is not a list');
      return batch as DanbooruPost[];
    } catch (e: unknown) {
      log.warn('Change catch-up page failed', {page, error: e});
      return null;
    }
  }

  /**
   * Overwrites the rows this page's posts already have, each under its own
   * `no`; returns how many. A post the rows lack is the sync's to add.
   */
  private async applyChangedPosts(
    uploaderId: number,
    batch: DanbooruPost[],
  ): Promise<number> {
    if (batch.length === 0) return 0;
    const existing = await this.db.posts.bulkGet(batch.map(p => p.id));
    const rows: PostRecord[] = [];
    batch.forEach((p, i) => {
      const row = existing[i];
      if (row && row.uploader_id === uploaderId) {
        rows.push(toPostRecord(p, row.no));
      }
    });
    if (rows.length > 0) {
      await bulkPutSafe(this.db.posts, rows, () =>
        evictOldestNonCurrentUser(this.db, uploaderId),
      );
    }
    return rows.length;
  }

  /**
   * Fetches user-level aggregate counts (gentags<10 / tagcount<10) used by
   * the scatter plot Tag Count mode Y=10 click feature. Cached in the
   * `user_stats` table with a 24h expiry.
   *
   * @param userInfo Target user
   * @param force If true, ignore cache and refetch
   */
  async getUserStats(
    userInfo: TargetUser,
    force = false,
  ): Promise<{gentags_lt_10: number; tagcount_lt_10: number} | null> {
    const userId = userInfo.id;
    if (!userId) return null;

    // Local rows (T-406): always current, no count; stored as before so the
    // cache stays filled for when the rows cannot be used.
    const local = await this.getLocalDistributions(parseInt(userId));
    if (local) {
      const fromRows = {
        gentags_lt_10: local.gentagsUnder10,
        tagcount_lt_10: local.tagcountUnder10,
      };
      await this.db.user_stats.put({
        userId,
        ...fromRows,
        updated_at: Date.now(),
      });
      return fromRows;
    }

    if (!force) {
      const cached = await this.db.user_stats.get(userId);
      if (cached && Date.now() - cached.updated_at < 24 * 60 * 60 * 1000) {
        return {
          gentags_lt_10: cached.gentags_lt_10,
          tagcount_lt_10: cached.tagcount_lt_10,
        };
      }
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const fetchCount = (tagQuery: string): Promise<number | null> =>
      this.fetchRemoteCount(tagQuery).catch(e => {
        log.warn('Count query failed for user stats', {tagQuery, error: e});
        return null;
      });

    const [gentags, tagcount] = await Promise.all([
      fetchCount(`user:${normalizedName} gentags:<10`),
      fetchCount(`user:${normalizedName} tagcount:<10`),
    ]);
    if (gentags === null || tagcount === null) {
      // A lost count is not a 0: keep whatever was stored (even past its
      // 24 h) and store nothing, so the next open asks again.
      const stale = await this.db.user_stats.get(userId);
      return stale
        ? {
            gentags_lt_10: stale.gentags_lt_10,
            tagcount_lt_10: stale.tagcount_lt_10,
          }
        : null;
    }

    const record: UserStatsRecord = {
      userId,
      gentags_lt_10: gentags,
      tagcount_lt_10: tagcount,
      updated_at: Date.now(),
    };
    await this.db.user_stats.put(record);

    return {gentags_lt_10: gentags, tagcount_lt_10: tagcount};
  }

  /**
   * Fetches the date when the user was promoted to a level that can approve posts (Approver+).
   * @param {string} userName
   * @return {Promise<string|null>} ISO date string (YYYY-MM-DD) or null.
   */
  async fetchPromotionDate(userName: string): Promise<string | null> {
    const history = await this.getPromotionHistory({name: userName});
    // Look for promotion to Approver, Admin, Moderator, etc.
    // Roles: Member -> Gold -> Platinum -> Builder -> Contributor -> Approver -> Moderator -> Admin
    // We look for the FIRST event where they reached 'Approver' level or higher.
    // Since it's hard to parse exact level order from text, we just look for 'Approver', 'Moderator', 'Admin'.
    // Actually, 'Builder' might also be relevant if we track that. But user asked for Approvals.
    // Let's assume 'Approver' or higher.

    // Simplified: Just find the earliest "Promoted to X" where X is Approver+.
    // But for safety, let's just use the logic: "When did they start approving?"
    // Better: Use the /user_feedbacks result to find "promoted to Approver".

    const targetRoles = ['Approver', 'Moderator', 'Admin'];
    const promoEvent = history.find(h =>
      targetRoles.some(r => h.role.includes(r)),
    );

    if (promoEvent) {
      return promoEvent.date.toISOString().slice(0, 10);
    }
    return null;
  }

  /**
   * Fetches promotion history from user feedbacks.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<Array<{date: Date, role: string, rawBody: string}>>}
   */
  async getPromotionHistory(userInfo: {
    name: string;
  }): Promise<PromotionEvent[]> {
    if (!userInfo.name) return [];
    try {
      const normalizedName = userInfo.name.replace(/ /g, '_');
      const url = `/user_feedbacks.json?commit=Search&search%5Bbody_matches%5D=promoted&search%5Buser_name%5D=${encodeURIComponent(normalizedName)}`;
      const feedbacks = await this.rateLimiter.fetch(url).then(r => r.json());

      if (!Array.isArray(feedbacks)) return [];

      return feedbacks
        .map((f: DanbooruUserFeedback) => {
          // Parse Body: "promoted to a Builder level account"
          const match = f.body.match(/promoted to a (.+?) level/i);
          const role = match ? match[1] : 'Unknown';
          return {
            date: new Date(f.created_at),
            role: role,
            rawBody: f.body,
          };
        })
        .filter((item: PromotionEvent) => item.role !== 'Unknown')
        .sort(
          (a: PromotionEvent, b: PromotionEvent) =>
            a.date.getTime() - b.date.getTime(),
        );
    } catch (e: unknown) {
      log.error('Failed to fetch promotion history', {error: e});
      return [];
    }
  }

  /**
   * Fetches user level change history from user_feedbacks API.
   * Handles both "from X to Y" and "to Y from X" body formats.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<!Array<!LevelChangeEvent>>}
   */
  async getLevelChangeHistory(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
  ): Promise<LevelChangeEvent[]> {
    if (!userInfo.name) return [];
    const normalizedName = userInfo.name.replace(/ /g, '_');

    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'level_change_history';

    const cached = await this.tryGetCachedStats<
      Array<Omit<LevelChangeEvent, 'date'> & {date: string}>
    >(cacheKey, uploaderId, forceRefresh);
    if (cached) {
      // Dates were JSON-stringified to strings when cached — revive them.
      return cached.map(e => ({...e, date: new Date(e.date)}));
    }

    // Known Danbooru levels ordered by rank (lowest → highest)
    const LEVEL_HIERARCHY = [
      'Restricted',
      'Member',
      'Gold',
      'Platinum',
      'Builder',
      'Contributor',
      'Janitor',
      'Approver',
      'Moderator',
      'Admin',
      'Owner',
    ];
    const levelRank = new Map(
      LEVEL_HIERARCHY.map((l, i) => [l.toLowerCase(), i]),
    );

    /**
     * Parses a feedback body into {fromLevel, toLevel, isPromotion} or null.
     * Extracts all known level names from text, then uses promotion/demotion
     * keyword + level hierarchy to determine from/to direction.
     */
    const parse = (
      body: string,
    ): {fromLevel: string; toLevel: string; isPromotion: boolean} | null => {
      // Find all known levels mentioned in the body (case-insensitive, unique)
      const found: string[] = [];
      const bodyLower = body.toLowerCase();
      for (const level of LEVEL_HIERARCHY) {
        if (bodyLower.includes(level.toLowerCase()) && !found.includes(level)) {
          found.push(level);
        }
      }
      if (found.length < 2) return null;

      // Determine promotion vs demotion from keywords
      const isPromotion = /promot/i.test(body);

      // Sort the two levels by hierarchy rank
      const sorted = found
        .slice(0, 2)
        .sort(
          (a, b) =>
            (levelRank.get(a.toLowerCase()) ?? 0) -
            (levelRank.get(b.toLowerCase()) ?? 0),
        );
      const [lower, higher] = sorted;

      // Promotion: lower → higher, Demotion: higher → lower
      return isPromotion
        ? {fromLevel: lower, toLevel: higher, isPromotion: true}
        : {fromLevel: higher, toLevel: lower, isPromotion: false};
    };

    try {
      const base = `/user_feedbacks.json?commit=Search&search[category]=neutral&search[user_name]=${encodeURIComponent(normalizedName)}`;
      const [promoted, demoted] = await Promise.all([
        this.rateLimiter
          .fetch(`${base}&search[body_matches]=promoted+to+from`)
          .then(r => r.json()),
        this.rateLimiter
          .fetch(`${base}&search[body_matches]=demoted+to+from`)
          .then(r => r.json()),
      ]);

      const all = [
        ...(Array.isArray(promoted) ? promoted : []),
        ...(Array.isArray(demoted) ? demoted : []),
      ];

      const events: LevelChangeEvent[] = [];
      for (const fb of all) {
        const body: string = fb.body || '';
        const parsed = parse(body);
        if (!parsed) continue;
        events.push({
          date: new Date(fb.created_at),
          fromLevel: parsed.fromLevel,
          toLevel: parsed.toLevel,
          isPromotion: parsed.isPromotion,
        });
      }

      // Sort oldest first, deduplicate by date+fromLevel+toLevel
      events.sort((a, b) => a.date.getTime() - b.date.getTime());
      const seen = new Set<string>();
      const dedup = events.filter(e => {
        const key = `${e.date.getTime()}-${e.fromLevel}-${e.toLevel}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, dedup);
      return dedup;
    } catch (e: unknown) {
      log.warn('Failed to fetch level change history', {error: e});
      return [];
    }
  }

  /**
   * Fetches milestone posts for the timeline (100th, 1000th, 10000th, N*10000th).
   * Lightweight — no thumbnail fetch, date only.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<!Array<!TimelineMilestone>>}
   */
  async getTimelineMilestones(
    userInfo: TargetUser,
  ): Promise<TimelineMilestone[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];

    const total = await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .count();
    if (total === 0) return [];

    const targets: number[] = [];
    if (total >= 100) targets.push(100);
    if (total >= 1000) targets.push(1000);
    for (let i = 10000; i <= total; i += 10000) targets.push(i);

    if (targets.length === 0) return [];

    const matches: ApiItem[] = await this.db.posts
      .where('[uploader_id+no]')
      .anyOf(targets.map(no => [uploaderId, no]))
      .toArray();

    const map = new Map(matches.map(p => [p.no, p]));

    return targets
      .map(t => {
        const p = map.get(t);
        if (!p || !p.created_at) return null;
        return {index: t, date: new Date(p.created_at)};
      })
      .filter(Boolean) as TimelineMilestone[];
  }

  /**
   * Fetches breast size distribution by checking specific tags.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getCommentaryDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus('Fetching Commentary Distribution...');
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'commentary_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const categories: Array<{
      name: string;
      tagName: string;
      query?: string;
      untagged?: boolean;
      color: string;
    }> = [
      {
        name: 'Commentary',
        tagName: 'commentary',
        query: `user:${normalizedName} commentary`,
        color: '#007bff',
      },
      {
        name: 'Requested',
        tagName: 'commentary_request',
        query: `user:${normalizedName} commentary_request`,
        color: '#ffc107',
      },
      {
        // Three counts (T-408): see buildUntaggedCommentaryQueries.
        name: 'Untagged',
        tagName: 'untagged_commentary',
        untagged: true,
        color: '#6c757d',
      },
    ];

    const results: DistributionItem[] = categories.map(cat => ({
      name: cat.name,
      tagName: cat.tagName,
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false,
      color: cat.color,
    }));

    await this.mapConcurrent(
      categories.map((cat, i) => ({...cat, idx: i})),
      3,
      async item => {
        if (reportSubStatus)
          reportSubStatus(`Fetching Commentary: ${item.name}`);
        const slice = results[item.idx];
        try {
          if (item.untagged) {
            const q = buildUntaggedCommentaryQueries(`user:${normalizedName}`);
            if (!Object.values(q).every(fitsViewerTagLimit)) {
              markLocked(slice);
              return;
            }
            const [total, commentary, request] = await Promise.all([
              counts.lookup(q.total),
              counts.lookup(q.commentary),
              counts.lookup(q.request),
            ]);
            slice.count = computeUntaggedCommentary({
              total,
              commentary,
              request,
            });
          } else if (item.query) {
            if (!fitsViewerTagLimit(item.query)) {
              markLocked(slice);
              return;
            }
            slice.count = await counts.lookup(item.query);
          }
        } catch (e: unknown) {
          slice.unknown = true;
          log.debug('Failed to fetch commentary count', {error: e});
        }
      },
    );

    const filtered = results.filter(r => r.count > 0 || r.unknown);
    const shown = await this.cacheUnlessPartial(
      cacheKey,
      uploaderId,
      filtered,
      counts.failed,
    );
    return shown;
  }

  /**
   * Fetches translation distribution.
   */
  async getTranslationDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus)
      reportSubStatus('Fetching Translation Distribution...');
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'translation_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const categories: Array<{
      name: string;
      tagName: string;
      query?: string;
      useInclusionExclusion?: boolean;
      color: string;
    }> = [
      {
        name: 'Translated',
        tagName: 'translated',
        query: `user:${normalizedName} translated`,
        color: '#28a745',
      },
      {
        name: 'Requested',
        tagName: 'translation_request',
        query: `user:${normalizedName} translation_request`,
        color: '#ffc107',
      },
      {
        name: 'Untagged',
        tagName: 'untagged_translation',
        useInclusionExclusion: true,
        color: '#6c757d',
      },
    ];

    const results: DistributionItem[] = categories.map(cat => ({
      name: cat.name,
      tagName: cat.tagName,
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false,
      color: cat.color,
    }));

    await this.mapConcurrent(
      categories.map((cat, i) => ({...cat, idx: i})),
      3,
      async item => {
        if (reportSubStatus)
          reportSubStatus(`Fetching Translation: ${item.name}`);
        try {
          if (item.useInclusionExclusion) {
            // Untagged via inclusion-exclusion: max(0, t − a − b − c + ab + ac).
            // See PLAN.md §9 for derivation. b, c, ab and ac are 3 terms
            // (the `*_text` wildcard counts), so an anonymous viewer gets a
            // 422 on them; any lost term throws and leaves Untagged unknown
            // rather than computed from a 0 that is not one.
            const q = buildUntaggedTranslationQueries(`user:${normalizedName}`);
            // Over the viewer's limit, none of the six is sent (T-408).
            if (![q.t, q.a, q.b, q.c, q.ab, q.ac].every(fitsViewerTagLimit)) {
              markLocked(results[item.idx]);
              return;
            }
            const [t, a, b, c, ab, ac] = await Promise.all([
              counts.lookup(q.t),
              counts.lookup(q.a),
              counts.lookup(q.b),
              counts.lookup(q.c),
              counts.lookup(q.ab),
              counts.lookup(q.ac),
            ]);
            results[item.idx].count = computeUntaggedTranslation({
              t,
              a,
              b,
              c,
              ab,
              ac,
            });

            // Assumption-1 runtime validation (monitoring only, does not affect result).
            // If |R ∩ TR| / t > 0.5%, the mutual exclusivity assumption is violated.
            if (!fitsViewerTagLimit(q.bc)) return;
            this.fetchRemoteCount(q.bc)
              .then(bc => {
                const ratio = bc / Math.max(1, t);
                if (ratio > 0.005) {
                  log.warn(
                    'Assumption-1 violation: R∩TR / T exceeds 0.5% threshold',
                    {
                      user: normalizedName,
                      ratio: `${(ratio * 100).toFixed(2)}%`,
                      bc,
                      t,
                    },
                  );
                }
              })
              .catch(() => {
                /* monitoring only */
              });
          } else if (item.query) {
            if (!fitsViewerTagLimit(item.query)) {
              markLocked(results[item.idx]);
              return;
            }
            results[item.idx].count = await counts.lookup(item.query);
          }
        } catch (e: unknown) {
          results[item.idx].unknown = true;
          log.debug('Failed to fetch translation count', {error: e});
        }
      },
    );

    const filtered = results.filter(r => r.count > 0 || r.unknown);
    const shown = await this.cacheUnlessPartial(
      cacheKey,
      uploaderId,
      filtered,
      counts.failed,
    );
    return shown;
  }

  /**
   * Fetches gender distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getGenderDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus('Fetching Gender Distribution...');
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'gender_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');

    // `originalTag` preserves the semantic OR query for click navigation
    // (matches the conceptual count query). On Gold+ accounts this navigates to
    // the full union of girl/boy/other variants. On Member(Blue) accounts the
    // 6-tag query exceeds the 2-tag limit and Danbooru returns an error page —
    // consistent with Translation Untagged click behavior.
    const genderCategories: Array<{
      name: string;
      tagName: string;
      originalTag?: string;
      subQueries?: string[];
      query?: string;
      color: string;
    }> = [
      {
        name: 'Girl',
        tagName: 'girl',
        originalTag: '~1girl ~2girls ~3girls ~4girls ~5girls ~6+girls',
        subQueries: [
          '1girl',
          '2girls',
          '3girls',
          '4girls',
          '5girls',
          '6+girls',
        ].map(tag => `user:${normalizedName} ${tag}`),
        color: '#e91e63',
      },
      {
        name: 'Boy',
        tagName: 'boy',
        originalTag: '~1boy ~2boys ~3boys ~4boys ~5boys ~6+boys',
        subQueries: ['1boy', '2boys', '3boys', '4boys', '5boys', '6+boys'].map(
          tag => `user:${normalizedName} ${tag}`,
        ),
        color: '#2196f3',
      },
      {
        name: 'Other',
        tagName: 'other',
        originalTag: '~1other ~2others ~3others ~4others ~5others ~6+others',
        subQueries: [
          '1other',
          '2others',
          '3others',
          '4others',
          '5others',
          '6+others',
        ].map(tag => `user:${normalizedName} ${tag}`),
        color: '#9c27b0',
      },
      {
        name: 'No Humans',
        tagName: 'no_humans',
        query: `user:${normalizedName} no_humans`,
        color: '#607d8b',
      },
    ];

    const results: DistributionItem[] = genderCategories.map(cat => ({
      name: cat.name,
      tagName: cat.tagName,
      originalTag: cat.originalTag,
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false,
      color: cat.color,
    }));

    await this.mapConcurrent(
      genderCategories.map((cat, i) => ({...cat, idx: i})),
      3,
      async item => {
        if (reportSubStatus) reportSubStatus(`Fetching Gender: ${item.name}`);
        try {
          if (item.subQueries) {
            const subCounts = await Promise.all(
              item.subQueries.map((q: string) =>
                counts.lookup(q).catch(() => 0),
              ),
            );
            results[item.idx].count = subCounts.reduce((sum, n) => sum + n, 0);
          } else if (item.query) {
            results[item.idx].count = await counts.lookup(item.query);
          }
        } catch (e: unknown) {
          log.debug('Failed to fetch gender count', {error: e});
        }
      },
    );

    const filtered = results.filter(r => r.count > 0);
    const shown = await this.cacheUnlessPartial(
      cacheKey,
      uploaderId,
      filtered,
      counts.failed,
    );
    return shown;
  }

  /**
   * Fetches breasts size distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getBreastsDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus('Fetching Breasts Distribution...');
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'breasts_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const breastTags = [
      'flat_chest',
      'small_breasts',
      'medium_breasts',
      'large_breasts',
      'huge_breasts',
      'gigantic_breasts',
    ];

    // Use mapConcurrent from base class to fetch efficiently
    // But Lazy Load the thumbs
    const results = breastTags.map(tag => ({
      name: tag
        .split('_')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' '),
      tagName: tag,
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false,
    }));

    // Calculate Counts
    await this.mapConcurrent(results, 3, async obj => {
      const tag = obj.tagName;
      if (reportSubStatus) reportSubStatus(`Fetching Breasts: ${obj.name}`);
      try {
        obj.count = await counts.lookup(`user:${normalizedName} ${tag}`);
      } catch (e: unknown) {
        log.debug('Failed to fetch breasts count', {error: e});
      }
    });

    // Filter out zero counts
    const filtered = results
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);

    // Reuse unchanged thumbs before this write replaces the cache (L-2).
    await this.carryOverThumbs(cacheKey, uploaderId, filtered);
    const shown = await this.cacheUnlessPartial(
      cacheKey,
      uploaderId,
      filtered,
      counts.failed,
    );

    await this.enrichThumbnails(
      cacheKey,
      uploaderId,
      shown,
      userInfo,
      reportSubStatus,
      !counts.failed,
    );

    return shown;
  }

  /**
   * Fetches hair length distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getHairLengthDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus)
      reportSubStatus('Fetching Hair Length Distribution...');
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'hair_length_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const hairLengthTags = [
      '~bald ~bald_female',
      'very_short_hair',
      'short_hair',
      'medium_hair',
      'long_hair',
      'very_long_hair',
      'absurdly_long_hair',
    ];

    const results = hairLengthTags.map((tag): DistributionItem => {
      let label = tag;
      if (tag.includes('~bald')) label = 'Bald';
      else
        label = tag
          .split('_')
          .map(s => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');

      return {
        name: label,
        count: 0,
        frequency: 0,
        originalTag: tag,
        thumb: null,
        isOther: false,
      };
    });

    await this.mapConcurrent(results, 3, async obj => {
      if (reportSubStatus) reportSubStatus(`Fetching Hair Length: ${obj.name}`);
      const query = `user:${normalizedName} ${obj.originalTag}`;
      // "Bald" is 3 terms: not sent for an anonymous viewer (T-408).
      if (!fitsViewerTagLimit(query)) {
        markLocked(obj);
        return;
      }
      try {
        obj.count = await counts.lookup(query);
      } catch (e: unknown) {
        obj.unknown = true;
        log.debug('Failed to fetch count', {error: e});
      }
    });

    const filtered = results
      .filter(r => r.count > 0 || r.unknown)
      .sort((a, b) => b.count - a.count);
    // Reuse unchanged thumbs before this write replaces the cache (L-2).
    await this.carryOverThumbs(cacheKey, uploaderId, filtered);
    const shown = await this.cacheUnlessPartial(
      cacheKey,
      uploaderId,
      filtered,
      counts.failed,
    );

    await this.enrichThumbnails(
      cacheKey,
      uploaderId,
      shown,
      userInfo,
      reportSubStatus,
      !counts.failed,
    );

    return shown;
  }

  /**
   * Fetches hair color distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getHairColorDistribution(
    userInfo: TargetUser,
    forceRefresh: boolean = false,
    reportSubStatus: ((msg: string) => void) | null = null,
  ): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus('Fetching Hair Color Distribution...');
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'hair_color_dist';
    const counts = this.countBatch();

    const cached = await this.tryGetCachedStats<DistributionItem[]>(
      cacheKey,
      uploaderId,
      forceRefresh,
      getCountCacheTtlMs(),
    );
    if (cached) return cached;

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const hairColorMap = [
      {tag: 'black_hair', color: '#000000'},
      {tag: 'brown_hair', color: '#A52A2A'},
      {tag: 'blonde_hair', color: '#FFD700'},
      {tag: 'red_hair', color: '#FF0000'},
      {tag: 'orange_hair', color: '#FFA500'},
      {tag: 'pink_hair', color: '#FFC0CB'},
      {tag: 'purple_hair', color: '#800080'},
      {tag: 'green_hair', color: '#008000'},
      {tag: 'blue_hair', color: '#0000FF'},
      {tag: 'aqua_hair', color: '#00FFFF'},
      {tag: 'grey_hair', color: '#808080'},
      {tag: 'white_hair', color: '#FFFFFF'},
    ];

    const results = hairColorMap.map(item => ({
      name:
        item.tag.split('_')[0].charAt(0).toUpperCase() +
        item.tag.split('_')[0].slice(1) +
        ' Hair',
      count: 0,
      frequency: 0,
      color: item.color,
      originalTag: item.tag,
      thumb: null,
      isOther: false,
    }));

    await this.mapConcurrent(results, 3, async obj => {
      if (reportSubStatus) reportSubStatus(`Fetching Hair Color: ${obj.name}`);
      try {
        obj.count = await counts.lookup(
          `user:${normalizedName} ${obj.originalTag}`,
        );
      } catch (e: unknown) {
        log.debug('Failed to fetch count', {error: e});
      }
    });

    const filtered = results
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);
    // Reuse unchanged thumbs before this write replaces the cache (L-2).
    await this.carryOverThumbs(cacheKey, uploaderId, filtered);
    const shown = await this.cacheUnlessPartial(
      cacheKey,
      uploaderId,
      filtered,
      counts.failed,
    );

    await this.enrichThumbnails(
      cacheKey,
      uploaderId,
      shown,
      userInfo,
      reportSubStatus,
      !counts.failed,
    );

    return shown;
  }

  /**
   * Copy thumbnails from the previously cached distribution onto a freshly
   * recomputed one, matching on tag.
   *
   * A forced refresh rebuilds the list with `thumb: null`, so `enrichThumbnails`
   * re-fetched a representative post for every top-10 entry — 30-50 requests a
   * sync spent re-deriving pictures that had not changed (audit L-2). The top
   * tags are stable between syncs, so the previous thumb is almost always the
   * same one we would fetch again.
   *
   * The trade-off is a thumb that lags its tag's current top-scoring post.
   * That is the right side to err on: the picture is decoration, the counts
   * beside it are the data, and a genuinely new tag has no cached thumb to
   * inherit so it still gets fetched.
   *
   * Must run *before* the caller's `saveStats` — that write replaces the
   * cached record this reads from.
   *
   * @param {string} cacheKey The piestats key for this distribution.
   * @param {number} uploaderId The user the distribution belongs to.
   * @param {DistributionItem[]} items Freshly computed items, mutated in place.
   */
  private async carryOverThumbs(
    cacheKey: string,
    uploaderId: number,
    items: DistributionItem[],
  ): Promise<void> {
    if (!uploaderId) return;
    const cached = (await this.getStats(cacheKey, uploaderId)) as
      | DistributionItem[]
      | null;
    if (!cached) return;

    const thumbByTag = new Map<string, string>();
    for (const prev of cached) {
      const key = distributionItemKey(prev);
      if (key && prev.thumb) thumbByTag.set(key, prev.thumb);
    }
    if (thumbByTag.size === 0) return;

    for (const item of items) {
      if (item.isOther || item.thumb) continue;
      // '' is never a stored key, so a keyless row simply misses.
      const prev = thumbByTag.get(distributionItemKey(item));
      if (prev) item.thumb = prev;
    }
  }

  async enrichThumbnails(
    cacheKey: string,
    uploaderId: number,
    items: DistributionItem[],
    userInfo: TargetUser,
    _statusCallback: ((msg: string) => void) | null = null,
    persist = true,
  ): Promise<void> {
    let hasUpdates = false;
    const normalizedName = userInfo.name.replace(/ /g, '_');

    // Identify items needing thumbs
    // Explicitly check for null or empty string, but sometimes empty string means "tried and failed".
    // Let's assume null means "not yet fetched".
    const toFetch = items.filter(i => !i.isOther && !i.thumb && !i.unknown);

    if (toFetch.length === 0) return;

    // Process in background

    await this.mapConcurrent(toFetch, 2, async item => {
      // Re-construct query based on cacheKey or item data?
      // "item" doesn't have the full query info derived in the parent function (e.g. hair_color map).
      // But we stored `tagName` or `originalTag` or `color`?
      // Character/Copyright/Breasts: `tagName` exists.
      // Hair Length: `originalTag`.
      // Hair Color: `originalTag`.

      // We need to standardize or deduce.
      const tagPart = item.tagName || item.originalTag;
      if (!tagPart && cacheKey === 'hair_color_dist') {
        // Infer from name? Vulnerable.
        // We should have saved originalTag.
        // In getHairColorDistribution, we updated to save `originalTag`.
      }

      if (!tagPart) return;

      // Construct Query
      // fav_copyright: search from user's favorites; others: from user's uploads
      let queryTags: string;
      if (cacheKey === 'fav_copyright_dist') {
        queryTags = `fav:${normalizedName} ${tagPart} rating:g order:score`;
      } else {
        queryTags = `user:${normalizedName} ${tagPart} order:score rating:g`;
      }

      // 3 terms (`user:`/`fav:`, the tag, `order:`), 4 for Hair "Bald"'s
      // `~bald ~bald_female`: over the viewer's limit the server answers
      // 422, so the slice goes without a thumbnail and no request is sent.
      if (!fitsViewerTagLimit(queryTags)) return;

      const thumb = await this.fetchThumbnailWithRetry(queryTags);
      if (thumb) {
        item.thumb = thumb;
        hasUpdates = true;
        // Optional: Notify UI for incremental update?
        // For now, let's just save at end or batch?
      }
    });

    if (hasUpdates && uploaderId) {
      // Save updated stats — unless `items` is a partial result its caller
      // declined to cache (see cacheUnlessPartial); the thumbs still reach
      // the open pie through the event below.
      if (persist) await this.saveStats(cacheKey, uploaderId, items);

      // Notify UI
      // How? We need a global event or callback.
      // Dispatch a window event? "DanbooruInsights:DataUpdated"
      window.dispatchEvent(
        new CustomEvent('DanbooruInsights:DataUpdated', {
          detail: {contentType: cacheKey, userId: uploaderId, data: items},
        }),
      );
    }
  }

  /**
   * Keep the candidates that are not the antecedent of an active
   * implication, in their original (frequency) order.
   *
   * One batched, cached lookup (core/top-level-tags) replaces the old
   * per-candidate `/tag_implications.json` fan-out — up to 53 requests for a
   * 46k-post character pie, 119 across the three related-tag pies, on every
   * refresh. A failed lookup keeps its candidates and caches nothing, where
   * the old path's per-tag catch silently kept variants whenever a request
   * was rate-limited.
   */
  private async filterTopLevelCandidates(
    candidates: DanbooruRelatedTag[],
    userInfo: TargetUser,
  ): Promise<DanbooruRelatedTag[]> {
    const flags = await getTopLevelFlags(
      this.rateLimiter,
      this.db,
      candidates.map(c => c.tag.name),
      parseInt(userInfo.id || '0'),
    );
    return candidates.filter(c => flags.get(c.tag.name) !== false);
  }

  /**
   * helper to get robust total count.
   *
   * One report click fans this out several times — the pre-check, the sync's
   * own total, the header status, and the three distributions that size their
   * candidate pool by it — and `fetchRemoteCount` has no cache, so each was a
   * fresh 400-900ms count query (audit L-3). The in-flight promise is memoised
   * per user for a short window so a single click's cascade collapses onto one
   * request. The window is deliberately much shorter than the count-cache TTL:
   * this is a de-duplicator for one interaction, not a cache, so a post
   * uploaded a minute ago still shows up.
   *
   * @param {Object} userInfo The user's info object.
   * @return {Promise<number>}
   */
  async getTotalPostCount(userInfo: TargetUser): Promise<number> {
    if (!userInfo.name) return 0;

    // `||`, not `??`: an absent id is sometimes '' rather than undefined (the
    // grass renderer synthesises that for its legacy string user form), and
    // '' would key every such user onto the same memo entry.
    const memoKey = userInfo.id || userInfo.name;
    const memo = this.totalCountMemo.get(memoKey);
    if (memo && Date.now() - memo.at < TOTAL_COUNT_MEMO_MS) {
      return memo.promise;
    }

    const pending = this.fetchTotalPostCount(userInfo);
    this.totalCountMemo.set(memoKey, {at: Date.now(), promise: pending});
    // A failed lookup must not be remembered — the next caller should retry
    // rather than inherit a 0 that means "unknown".
    void pending.then(
      value => {
        if (!value) this.totalCountMemo.delete(memoKey);
      },
      () => this.totalCountMemo.delete(memoKey),
    );
    return pending;
  }

  /** Uncached body of {@link getTotalPostCount} — three fallbacks in order. */
  private async fetchTotalPostCount(userInfo: TargetUser): Promise<number> {
    try {
      // Method A: Exact Search Count (API)
      const normalizedName = userInfo.name.replace(/ /g, '_');
      return await this.fetchRemoteCount(`user:${normalizedName}`);
    } catch (e: unknown) {
      log.warn('Counts API failed', {error: e});
    }

    // Method B: Profile API Fallback
    try {
      const profileUrl = `/users/${userInfo.id}.json`;
      const profile = await this.rateLimiter
        .fetch(profileUrl)
        .then(r => r.json());
      if (profile && typeof profile.post_upload_count === 'number') {
        return profile.post_upload_count;
      }
    } catch (_e2: unknown) {
      log.debug('Failed to fetch user profile', {error: _e2});
    }

    // Method C: DOM Fallback
    try {
      const parsed = this.parseUploadCountFromDom();
      // A malformed/absent count parses to NaN; every comparison against
      // NaN is false, which would put callers in a re-sync-on-every-click
      // loop. Fall through to the "could not determine" return instead.
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    } catch (_e3: unknown) {
      log.debug('Failed to parse DOM stats', {error: _e3});
    }

    return 0; // Failed
  }

  /**
   * Reads the "Uploads" count out of the profile page's statistics table
   * (rendered inside our `#danbooru-grass-wrapper`). Matches on the row's
   * label text rather than a fixed row index — a positional selector
   * silently reads a different row (e.g. "Deleted Uploads") if Danbooru
   * reorders the table — and falls back to the previous positional selector
   * if no labeled row is found, so currently-working pages don't regress.
   * @return {number} Parsed count, or NaN if none could be determined.
   */
  private parseUploadCountFromDom(): number {
    const rows = document.querySelectorAll('#danbooru-grass-wrapper table tr');
    for (const row of rows) {
      const labelCell = row.querySelector('th') ?? row.querySelector('td');
      const label = (labelCell?.textContent ?? '').trim().toLowerCase();
      // Exact match only: the same table carries "Upload Limit" and
      // "Deleted Uploads" rows, and a substring test would happily read the
      // account's upload allowance as its total post count. No match at all
      // → the positional fallback below.
      if (label !== 'uploads') continue;

      const cells = row.querySelectorAll('td');
      const valueCell = cells[cells.length - 1] ?? row.querySelector('td');
      // The count is normally a link (to /posts?tags=user:<name>), but a
      // plain-text cell is still worth parsing before giving up.
      const valueText = (valueCell?.querySelector('a') ?? valueCell)
        ?.textContent;
      return parseInt((valueText ?? '').replace(/,/g, ''), 10);
    }

    const statsLink = document.querySelector(
      '#danbooru-grass-wrapper > div:nth-child(1) > table > tbody > tr:nth-child(6) > td > a:nth-child(1)',
    );
    return statsLink
      ? parseInt((statsLink.textContent ?? '').replace(/,/g, ''), 10)
      : NaN;
  }

  /**
   * Syncs all posts for the user using parallel buffered fetching.
   * Orchestrator only — the three private helpers below
   * (calculateResumeStartId → createSyncPageWorker → finalizeSyncMetadata)
   * carry the actual logic.
   *
   * @param {Object} userInfo The user's info object.
   * @param {Function} onProgress Callback for progress updates (current, total).
   * @return {Promise<SyncOutcome>} `complete: false` when the run did not
   *   cover every page: the data is prefix-consistent but partial, so callers
   *   should warn rather than report success, and the next open resumes it.
   *   The two early returns below never fetched anything at all — they carry
   *   `started: false` so callers can tell "nothing changed" apart from
   *   "changed, but only partly".
   * @param options.pageLimit Posts per page, {@link SYNC_PAGE_LIMIT} unless
   *   a test serves smaller pages (a page shorter than this ends the run).
   */
  async syncAllPosts(
    userInfo: TargetUser,
    onProgress: (current: number, total: number, message?: string) => void,
    options: {pageLimit?: number} = {},
  ): Promise<SyncOutcome> {
    if (!userInfo.id) {
      log.error('User ID required for sync');
      return {complete: false, started: false};
    }

    const uploaderId = parseInt(userInfo.id ?? '0');

    // Global Sync Lock
    if (AnalyticsDataManager.isGlobalSyncing) {
      log.warn('Sync already in progress');
      return {complete: false, started: false};
    }
    AnalyticsDataManager.isGlobalSyncing = true;
    AnalyticsDataManager.syncProgress = {current: 0, total: 0, message: ''};
    AnalyticsDataManager.onProgressCallback = onProgress;

    // Helper to broadcast progress
    const reportProgress = (c: number, t: number, msg: string = '') => {
      AnalyticsDataManager.syncProgress = {current: c, total: t, message: msg};
      if (AnalyticsDataManager.onProgressCallback) {
        AnalyticsDataManager.onProgressCallback(c, t, msg);
      }
      if (onProgress) onProgress(c, t, msg);
    };

    const perfStats = {
      totalPosts: 0,
      startId: 0,
      initialCurrentNo: 0,
      pagesCommitted: 0,
      finalCurrentNo: 0,
    };
    perfLogger.start('dbi:db:sync:full:total');
    const edge429sAtStart = this.rateLimiter.trafficSummary().edge429s;
    const syncStartedAt = Date.now();

    try {
      // Mid-sync until it completes: the stale-data cleanup keeps the rows
      // of a run that fails (T-404).
      await patchSyncMeta(this.db, uploaderId, {syncStartedAt});

      // 1. Get total count
      const total = await perfLogger.wrap('dbi:db:sync:full:countQuery', () =>
        this.getTotalPostCount(userInfo),
      );
      perfStats.totalPosts = total;

      // 2. Resume Check — find startId + seed currentNo for sequential
      // `no` field assignment. See helper for the dropped early-return
      // guard ("startId === 0 && currentNo >= total" was unreachable —
      // currentNo only becomes positive when startId > 0).
      const resume = await this.calculateResumeStartId(uploaderId);
      const {startId} = resume;
      let {currentNo} = resume;
      perfStats.startId = startId;
      perfStats.initialCurrentNo = currentNo;

      // A run from the start searches from the user's first post, not
      // `id:>0` (T-508). `startId` keeps meaning "from the start" for the
      // ghost prune and the completion stamps.
      const anchor = await this.syncAnchor(userInfo, startId);

      // 3. Worker pool — claim pages, fetch with retry, commit in order.
      // Danbooru refuses numbered pages past the viewer's page limit, so the
      // pool runs one segment of SYNC_SEGMENT_PAGES at a time: when a
      // segment runs out of page numbers with posts still coming, the next
      // one searches `id:>` the last post committed and counts from page 1.
      let pageFailed = false;
      const seenIds = new Set<number>();
      let lastSeenId = anchor;
      let segmentStartId = anchor;
      // The server's clock at the first page: the rows reflect Danbooru as
      // of then at the latest (T-402's change watermark).
      let firstResponseAt: number | null = null;
      for (;;) {
        let pageOffset = 1;
        let hasMore = true;
        const buffer = new Map<number, DanbooruPost[]>();
        let nextExpectedPage = 1;

        const worker = this.createSyncPageWorker({
          userInfo,
          uploaderId,
          startId: segmentStartId,
          limit: options.pageLimit ?? SYNC_PAGE_LIMIT,
          getCurrentNo: () => currentNo,
          bumpCurrentNo: () => ++currentNo,
          total,
          buffer,
          getNextExpectedPage: () => nextExpectedPage,
          bumpNextExpectedPage: () => ++nextExpectedPage,
          claimPage: () =>
            pageOffset <= SYNC_SEGMENT_PAGES ? pageOffset++ : null,
          getHasMore: () => hasMore,
          setHasMore: v => {
            hasMore = v;
          },
          markFailed: () => {
            pageFailed = true;
          },
          markSeen: ids => {
            for (const id of ids) {
              seenIds.add(id);
              if (id > lastSeenId) lastSeenId = id;
            }
          },
          noteResponse: resp => {
            firstResponseAt ??= responseServerTime(resp, Date.now());
          },
          reportProgress,
          perfStats,
        });

        const workers: Promise<void>[] = [];
        for (let i = 0; i < SYNC_WORKERS; i++) {
          workers.push(worker(i));
        }
        await Promise.all(workers);

        // Still more to fetch only if every page of the segment came back
        // with posts: no empty page (hasMore) and no failure.
        const segmentFull =
          hasMore && !pageFailed && nextExpectedPage > SYNC_SEGMENT_PAGES;
        if (!segmentFull) break;
        if (lastSeenId <= segmentStartId) {
          // The next segment would repeat this one.
          log.error('Sync segment did not advance, stopping', {
            segmentStartId,
          });
          pageFailed = true;
          break;
        }
        segmentStartId = lastSeenId;
      }

      // Reconcile the re-fetched window before the completion stamps: drop
      // rows the remote no longer returns, so the local DB is a snapshot of
      // the window rather than a union of every sync that ever ran.
      if (!pageFailed && perfStats.pagesCommitted > 0) {
        await this.pruneGhostPosts(uploaderId, startId, seenIds);
      }

      await this.finalizeSyncMetadata({
        userInfo,
        uploaderId,
        startId,
        total,
        committed: currentNo,
        reportProgress,
        succeeded: !pageFailed,
        firstResponseAt: firstResponseAt ?? syncStartedAt,
      });

      perfStats.finalCurrentNo = currentNo;
      return {complete: !pageFailed, started: true};
    } finally {
      perfLogger.end('dbi:db:sync:full:total', perfStats);
      // The edge's rule is unknown; a long sync is the best sample of it.
      // Logged even with no 429, which bounds the limit from below (T-209).
      const traffic = this.rateLimiter.trafficSummary();
      log.info('Sync traffic', {
        edge429s: traffic.edge429s - edge429sAtStart,
        ...traffic.peakOk,
        pages: perfStats.pagesCommitted,
        elapsedMs: Date.now() - syncStartedAt,
      });
      AnalyticsDataManager.isGlobalSyncing = false;
      AnalyticsDataManager.onProgressCallback = null;
    }
  }

  /** The id the sync's search starts after: the resume's, or {@link findFirstPostAnchor}'s. */
  private syncAnchor(userInfo: TargetUser, startId: number): Promise<number> {
    return startId === 0
      ? this.findFirstPostAnchor(userInfo)
      : Promise.resolve(startId);
  }

  /**
   * Where a sync from the start begins: one below the user's first post,
   * or 0 (T-508). `user:X order:id id:>0` makes Danbooru walk the primary
   * key from id 0 until the user's posts begin; for an account whose
   * uploads start millions of ids in, its first pages took 7–8 s logged in
   * and failed the 3 s logged-out limit with a 500 (browser check,
   * 2026-11-16: 3.4 s and a 500 against 0.35–0.66 s for the same posts
   * found by date or by `id:>` the first one). The first post is found with
   * `date:>=` the day before the join date, and trusted only when a count
   * finds none of the user's posts below it: a join date scraped wrong
   * (the profile scrape falls back to "now") would otherwise skip the older
   * posts. Any doubt or failure gives 0, the old search.
   */
  private async findFirstPostAnchor(userInfo: TargetUser): Promise<number> {
    const since = dayBeforeJoin(userInfo.joinDate);
    if (!since || !userInfo.name) return 0;
    const name = userInfo.name.replace(/ /g, '_');
    try {
      const params = new URLSearchParams({
        tags: `user:${name} order:id date:>=${since}`,
        limit: '1',
        only: 'id',
      });
      const resp = await this.rateLimiter.fetch(
        `/posts.json?${params.toString()}`,
      );
      if (!resp.ok) return 0;
      const body: unknown = await resp.json();
      const firstId = Array.isArray(body)
        ? (body[0] as {id?: unknown} | undefined)?.id
        : undefined;
      if (typeof firstId !== 'number' || firstId < 1) return 0;
      const below = await this.fetchRemoteCount(`user:${name} id:<${firstId}`);
      if (below !== 0) {
        log.warn('Posts before the first one found; syncing from id 0', {
          firstId,
          below,
        });
        return 0;
      }
      return firstId - 1;
    } catch (e: unknown) {
      log.debug('First post lookup failed; syncing from id 0', {error: e});
      return 0;
    }
  }

  /**
   * Find the resume cutoff for this user's posts and seed `currentNo` so
   * the worker's `no: ++currentNo` assignment continues from where the
   * last sync left off.
   *
   * Strategy: 1-month overlap. Walk backwards from the newest post until
   * we cross the `newest - 30 days` cutoff; that post's id is `startId`.
   * Re-syncing the trailing month catches metadata updates (score/tags)
   * without re-fetching everything.
   *
   * Fresh sync (no history): startId = 0, currentNo = 0, full pull.
   * Resume sync (startId > 0): currentNo = "count of this user's posts
   * with id ≤ startId", which keeps the sequential post numbers monotonic.
   *
   * Rows whose numbering has a gap ({@link rowNumberingIntact} false) sync
   * from the start instead (T-404): a resume re-fetches only the last
   * month and can never fill an older hole, so "Data Synchronization
   * Required" came back after every resume.
   *
   * Note: the original code had an unreachable `if (startId === 0 &&
   * total > 0 && currentNo >= total) return` early-return guard —
   * currentNo only becomes positive when startId > 0, so the guard
   * literally never fires. T-25 dropped it.
   */
  private async calculateResumeStartId(
    uploaderId: number,
  ): Promise<{startId: number; currentNo: number}> {
    perfLogger.start('dbi:db:sync:full:resumeCheck');
    const newestArr = await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .reverse()
      .limit(1)
      .toArray();
    let startId = 0;
    // A catch-up that ran past the page limit (T-407) left changes the rows
    // cannot get any other way: start over too.
    const overflowed =
      newestArr.length > 0 &&
      (await readSyncMeta(this.db, uploaderId))?.needsFullSync === true;
    const intact =
      newestArr.length === 0 ||
      (!overflowed && (await this.rowNumberingIntact(uploaderId)));
    if (!intact) {
      log.warn('Syncing from the start', {
        uploaderId,
        reason: overflowed ? 'catch-up overflow' : 'numbering gap',
      });
    }

    if (newestArr.length > 0 && intact) {
      const newest = newestArr[0];
      const newestDate = new Date(newest.created_at);
      const cutOffDate = new Date(newestDate);
      cutOffDate.setMonth(cutOffDate.getMonth() - 1);

      // Find the first post that is OLDER than cutOffDate. .until() stops
      // iteration immediately after the first match.
      let cutOffFound = false;
      await this.db.posts
        .where('uploader_id')
        .equals(uploaderId)
        .reverse()
        .until(() => cutOffFound)
        .each((p: ApiItem) => {
          if (new Date(p['created_at']) < cutOffDate) {
            startId = p['id'];
            cutOffFound = true;
          }
        });

      // Fallback: if history is shorter than 1 month, startId stays 0
      // (Full Sync).
    }

    let currentNo = 0;
    if (startId > 0) {
      // This user's posts at or below startId, counted from the index's
      // primary keys (T-502): a `.filter()` here read every row of the
      // user only to look at its id (about 1 s for 50k rows).
      const ids = await this.db.posts
        .where('uploader_id')
        .equals(uploaderId)
        .primaryKeys();
      for (const id of ids) if (id <= startId) currentNo++;
    }
    perfLogger.end('dbi:db:sync:full:resumeCheck', {
      startId,
      initialCurrentNo: currentNo,
      hasHistory: newestArr.length > 0,
      intact,
    });
    return {startId, currentNo};
  }

  /**
   * Whether a user's rows are numbered without a gap: their count equals
   * the highest `no` (T-404, audit DA-07). Index reads only — a count on
   * `uploader_id` and the last key of `[uploader_id+no]`. A user without
   * rows is intact. A gap means rows went missing below the newest one
   * (a ghost prune, an old bug): the local pies would undercount, and only
   * a sync from the start can fill it.
   */
  async rowNumberingIntact(uploaderId: number): Promise<boolean> {
    const count = await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .count();
    if (count === 0) return true;
    const last = await this.db.posts
      .where('[uploader_id+no]')
      .between([uploaderId, -Infinity], [uploaderId, Infinity])
      .last();
    return last?.no === count;
  }

  /**
   * Drop this user's rows above `startId` that the just-completed sync did
   * not return — posts that vanished from Danbooru's search since the last
   * run: expunged (permanently destroyed), or no longer credited to this
   * uploader.
   *
   * Plain *deleted* posts are not ghosts: Danbooru's default search includes
   * them (no `status:` metatag needed — verified 2026-10-29 against this
   * sync's own query), so the re-fetch overwrites their row with
   * `is_deleted: true`. Only a post the search no longer returns at all
   * leaves a ghost. Without this pass the old row survives
   * while the posts that outlived it are renumbered, so its stale `no`
   * collides with a live post's: `[uploader_id+no]` milestone lookups pick
   * whichever row Dexie hands back first, local counts drift above the
   * remote count (making the needsSync check too lenient), and the scatter
   * plots a post that no longer exists. Only the >1200-post worker path is
   * affected — quickSync clears the user first, so it never accumulates ghosts.
   *
   * Ordering matters: this runs only after a clean run (`markFailed` never
   * fired) and only when at least one page committed. A partial run has not
   * seen every page, so a post missing from `seenIds` may simply be one we
   * never asked for — pruning on that evidence would delete live data. This
   * is also why the reconcile happens *after* the fetch rather than as a
   * delete-then-refetch before it: nothing is removed until the replacement
   * data is already committed, so an interrupted sync can never leave a hole.
   *
   * @param {number} uploaderId The user whose rows to reconcile.
   * @param {number} startId Rows at or below this id were outside the
   *   re-fetched window and are left alone.
   * @param {Set<number>} seenIds Post ids the remote returned this run.
   * @return {Promise<number>} How many ghost rows were deleted.
   */
  private async pruneGhostPosts(
    uploaderId: number,
    startId: number,
    seenIds: Set<number>,
  ): Promise<number> {
    // Keys-only index scan: `id` IS the posts table's primary key, so the
    // range/seen filtering can happen on the returned numbers. A
    // filter().primaryKeys() combination would instantiate every row of what
    // can be a 100k-row table just to read its id back out.
    const allIds = (await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .primaryKeys()) as number[];
    const ghostIds = allIds.filter(id => id > startId && !seenIds.has(id));

    if (ghostIds.length === 0) return 0;

    await this.db.posts.bulkDelete(ghostIds);
    log.debug('Pruned remotely-deleted posts', {
      uploaderId,
      startId,
      pruned: ghostIds.length,
    });
    return ghostIds.length;
  }

  /**
   * Build the worker function used by the syncAllPosts worker pool.
   * Each worker:
   *   1. claims the next page via `claimPage` (shared atomic counter),
   *   2. fetches with retries on 429 / 5xx / timeout / network errors
   *      (classifySyncFetchError, up to SYNC_PAGE_MAX_ATTEMPTS),
   *   3. buffers the result by page number,
   *   4. drains the buffer in order — bulkPut'ing each batch with
   *      `no: ++currentNo` sequential numbering.
   *
   * Ordered commit ensures the `no` field is monotonic across the whole
   * sync even though pages may complete out of order.
   *
   * Workers stagger their start (200ms * workerId) so the initial burst
   * doesn't all hit the API at once. Each worker's cycle is the server's
   * time for a page (about 1 s live) plus WORKER_DELAY (400ms), so
   * SYNC_WORKERS sets the sync's real pace; the shared rate limiter
   * (`CONFIG.RATE_LIMITER`) caps it when pages come back faster or other
   * traffic joins.
   */
  private createSyncPageWorker(args: {
    userInfo: TargetUser;
    uploaderId: number;
    startId: number;
    /** Posts per page; a shorter page is the last. */
    limit: number;
    getCurrentNo: () => number;
    bumpCurrentNo: () => number;
    total: number;
    buffer: Map<number, DanbooruPost[]>;
    getNextExpectedPage: () => number;
    bumpNextExpectedPage: () => number;
    /** The next page number, or null once the segment has none left. */
    claimPage: () => number | null;
    getHasMore: () => boolean;
    setHasMore: (v: boolean) => void;
    markFailed: () => void;
    markSeen: (ids: number[]) => void;
    /** Called with every successful page response (its `Date` header). */
    noteResponse: (resp: Response) => void;
    reportProgress: (c: number, t: number, msg?: string) => void;
    perfStats: {pagesCommitted: number};
  }): (workerId: number) => Promise<void> {
    const {
      userInfo,
      uploaderId,
      startId,
      limit,
      getCurrentNo,
      bumpCurrentNo,
      total,
      buffer,
      getNextExpectedPage,
      bumpNextExpectedPage,
      claimPage,
      getHasMore,
      setHasMore,
      markFailed,
      markSeen,
      noteResponse,
      reportProgress,
      perfStats,
    } = args;
    const WORKER_DELAY = 400; // pause between pages, per worker

    // T-26 baseline: arrow complexity 20. Worker body — retry/backoff +
    // buffer commit ordering + sequential `no` assignment + completion
    // detection. Already a T-25 extracted helper; further split would
    // fragment the retry state.
    // eslint-disable-next-line complexity
    return async (workerId: number) => {
      const workerLabel = `dbi:db:sync:full:worker.${workerId}`;
      const pageLabel = `dbi:db:sync:full:page.w${workerId}`;
      const bulkPutLabel = `dbi:db:sync:full:bulkPut.w${workerId}`;
      let pagesFetched = 0;
      let pagesCommittedByWorker = 0;
      perfLogger.start(workerLabel);

      // Staggered Start: Prevent initial burst
      if (workerId > 0) await new Promise(r => setTimeout(r, workerId * 200));

      try {
        while (getHasMore()) {
          // 1. Claim a page — once the buffer has room (T-504): while an
          // earlier page is stuck in its retries, the pages behind it wait
          // in memory, and more requests would only add to them.
          if (!(await waitForBufferRoom(buffer, getHasMore))) return;
          const currentPage = claimPage();
          if (currentPage === null) return;
          perfLogger.start(pageLabel);
          let pageFetchedCount = 0;
          let pageAttempts = 0;

          try {
            const params: Record<string, string> = {
              limit: String(limit),
              page: String(currentPage),
              tags: `user:${userInfo.name.replace(/ /g, '_')} order:id id:>${startId}`,
              only: SYNC_POST_FIELDS,
            };
            const q = new URLSearchParams(params);
            const url = `/posts.json?${q.toString()}`;

            const pending = buffer.size;
            reportProgress(
              getCurrentNo(),
              total,
              `Fetching Page ${currentPage} (Pending: ${pending})...`,
            );

            // Retry Logic — see classifySyncFetchError for what is retried.
            let items: DanbooruPost[] | null = null;
            let attempts = 0;
            while (attempts < SYNC_PAGE_MAX_ATTEMPTS) {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s Timeout
              try {
                const fetchResp = await this.rateLimiter.fetch(url, {
                  signal: controller.signal,
                });
                if (!fetchResp.ok) throw new Error(`HTTP ${fetchResp.status}`);
                noteResponse(fetchResp);
                items = await fetchResp.json();
                break; // Success
              } catch (err: unknown) {
                attempts++;
                const kind = classifySyncFetchError(err);
                workerLog.warn('Page fetch attempt failed', {
                  workerId,
                  page: currentPage,
                  attempt: attempts,
                  kind,
                  error: err instanceof Error ? err.message : String(err),
                });

                if (kind === 'fatal' || attempts >= SYNC_PAGE_MAX_ATTEMPTS) {
                  throw err; // Give up or fatal error
                }
                const waitMs = syncRetryDelayMs(
                  kind,
                  attempts,
                  this.rateLimiter.backoffRemainingMs(),
                );
                await new Promise(r => setTimeout(r, waitMs));
              } finally {
                clearTimeout(timeoutId);
              }
            }
            pageAttempts = attempts + 1;

            if (!items || items.length === 0) {
              setHasMore(false); // Signal end
              return;
            }
            pageFetchedCount = items.length;
            pagesFetched++;

            // 2. Buffer the result
            buffer.set(currentPage, items);
            // A short page is the last (T-504): claim no more. Pages already
            // in flight past it come back empty.
            if (items.length < limit) setHasMore(false);

            // 3. Ordered Commit Loop (Check if we can save)
            while (buffer.has(getNextExpectedPage())) {
              const expected = getNextExpectedPage();
              const batchItems = buffer.get(expected);
              buffer.delete(expected); // Remove from buffer

              if (batchItems && batchItems.length > 0) {
                // Assign Sequential Numbers
                const bulkData = batchItems.map((p: DanbooruPost) =>
                  toPostRecord(p, bumpCurrentNo()),
                );

                perfLogger.start(bulkPutLabel);
                await bulkPutSafe(this.db.posts, bulkData, () =>
                  evictOldestNonCurrentUser(this.db, uploaderId),
                );
                // Remember what the remote actually returned, so a clean run
                // can prune rows the remote no longer has (see pruneGhostPosts).
                markSeen(bulkData.map(r => r.id));
                perfLogger.end(bulkPutLabel, {
                  workerId,
                  page: expected,
                  count: bulkData.length,
                });
                pagesCommittedByWorker++;
                perfStats.pagesCommitted++;

                // Update Progress — currentNo is monotonic via bumpCurrentNo
                const current = getCurrentNo();
                reportProgress(current, total > current ? total : current);
              }

              bumpNextExpectedPage();
            }
          } catch (e: unknown) {
            workerLog.error('Page failed, stopping sync', {
              workerId,
              page: currentPage,
              error: e,
            });
            // Stopping here leaves the DB prefix-consistent (ordered commit),
            // so the next sync resumes cleanly — but the run did NOT cover
            // every page. Flag it so the caller skips the "synced" stamp and
            // warns, instead of reporting success over partial data.
            markFailed();
            setHasMore(false);
          } finally {
            perfLogger.end(pageLabel, {
              workerId,
              page: currentPage,
              fetched: pageFetchedCount,
              attempts: pageAttempts,
            });
          }

          // Rate Limit Sleep
          if (getHasMore()) {
            await new Promise(r => setTimeout(r, WORKER_DELAY));
          }
        }
      } finally {
        perfLogger.end(workerLabel, {
          workerId,
          pagesFetched,
          pagesCommittedByWorker,
        });
      }
    };
  }

  /**
   * Post-sync metadata: stamp last-sync date, mark post-metadata
   * backfill complete for full (fresh) syncs, evict stale data from
   * other users, refresh aggregated stats, and request persistent
   * storage (first-time engagement signal). Idempotent across calls
   * — safe to invoke per sync.
   */
  private async finalizeSyncMetadata(args: {
    userInfo: TargetUser;
    uploaderId: number;
    startId: number;
    total: number;
    /** This user's post count after the run (resume seed + pages committed). */
    committed: number;
    reportProgress: (c: number, t: number, msg?: string) => void;
    succeeded: boolean;
    /** Server time of the run's first page response (ms). */
    firstResponseAt: number;
  }): Promise<void> {
    const {
      userInfo,
      uploaderId,
      startId,
      total,
      committed,
      reportProgress,
      succeeded,
      firstResponseAt,
    } = args;

    // Completion claims are only written when every page landed. Stamping
    // them after a failed page would tell the next open "this user is fully
    // synced" over partial data, and the resume would never happen. The
    // stats refresh below still runs — what we did commit is
    // prefix-consistent and should be reflected in the UI.
    if (succeeded) {
      // Save "Last Synced Date" metadata
      const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
      localStorage.setItem(lastSyncKey, new Date().toISOString());

      // A fresh (startId 0) run wrote every row with fields version 2. An
      // incremental one touched only the last month: older rows may still
      // lack the fields, and the backfill brings them up (T-403).
      if (startId === 0) {
        await this.recordFullSyncMeta(uploaderId, firstResponseAt);
      } else {
        await patchSyncMeta(this.db, uploaderId, {syncStartedAt: undefined});
      }
    }

    // Other users' stale data (cleanupStaleData) is no longer cleaned here:
    // the app runs it once the dashboard after the sync is painted (T-503).

    // Signal UI: Processing Stats. A failed run reports what it actually
    // committed — painting total/total here showed "46,894 / 46,894 (100%)"
    // over a sync that had stopped thousands of posts short.
    reportProgress(
      succeeded ? total : Math.min(committed, total),
      total,
      'PREPARING',
    );

    // Refresh the critical (cheap, must-be-fresh) stats after sync. If startId
    // was 0, it was a Full Sync; otherwise it's a Partial Sync. Heavy tag
    // distributions freshen post-paint via fetchDashboardData's SWR revalidate.
    // The rows changed: count them again (T-406).
    this.forgetLocalRows(uploaderId);
    await this.refreshCriticalStats(userInfo, startId === 0);

    // First successful sync = meaningful engagement signal. Ask the
    // browser for persistent storage so this user's analytics survive
    // Safari ITP / Chrome eviction heuristics. Idempotent across calls.
    await requestPersistence();
  }

  /**
   * After a sync that wrote every one of the user's rows from the first
   * post on (T-402): the rows hold fields version 2, reflect Danbooru as of
   * the run's first response, and carry `created_at` strings in the
   * viewer's current time zone. A resume sync, which re-fetches only the
   * last month, changes none of the three. The sync is over: its
   * in-progress mark goes (T-404).
   */
  private async recordFullSyncMeta(
    uploaderId: number,
    firstResponseAt: number,
  ): Promise<void> {
    await patchSyncMeta(this.db, uploaderId, {
      fieldsVersion: POST_FIELDS_VERSION,
      changeWatermark: firstResponseAt,
      timeZone: viewerTimeZone(),
      syncStartedAt: undefined,
      // A new watermark: catch-up progress against the old one is void.
      catchUp: undefined,
      needsFullSync: undefined,
    });
  }

  /**
   * Quickly syncs all posts for small users (total ≤ 1200) using sequential
   * cursor-based pagination. Simpler and faster than the full worker-pool approach.
   * @param {TargetUser} userInfo The user's info object.
   * @param {Function=} onProgress Optional progress callback (current, total, message).
   * @return {Promise<void>}
   */
  async quickSyncAllPosts(
    userInfo: TargetUser,
    onProgress?: (current: number, total: number, msg?: string) => void,
  ): Promise<void> {
    if (!userInfo.id || !userInfo.name) return;

    if (AnalyticsDataManager.isGlobalSyncing) {
      log.warn('Sync already in progress');
      return;
    }
    AnalyticsDataManager.isGlobalSyncing = true;
    AnalyticsDataManager.syncProgress = {current: 0, total: 0, message: ''};
    AnalyticsDataManager.onProgressCallback = onProgress || null;

    const reportProgress = (c: number, t: number, msg: string = '') => {
      AnalyticsDataManager.syncProgress = {current: c, total: t, message: msg};
      if (AnalyticsDataManager.onProgressCallback) {
        AnalyticsDataManager.onProgressCallback(c, t, msg);
      }
      if (onProgress) onProgress(c, t, msg);
    };

    const perfStats = {totalPosts: 0, pages: 0, writtenPosts: 0};
    perfLogger.start('dbi:db:sync:quick:total');

    try {
      const uploaderId = parseInt(userInfo.id ?? '0');
      const normalizedName = userInfo.name.replace(/ /g, '_');

      // 1. Get total count
      const total = await perfLogger.wrap('dbi:db:sync:quick:countQuery', () =>
        this.getTotalPostCount(userInfo),
      );
      perfStats.totalPosts = total;
      reportProgress(0, total, 'Fetching posts...');

      // Mid-sync until it completes (T-404): a failed run's rows survive
      // the stale-data cleanup. Cleared by recordFullSyncMeta.
      await patchSyncMeta(this.db, uploaderId, {syncStartedAt: Date.now()});

      // From the user's first post rather than id 0 (T-508).
      const anchor = await this.findFirstPostAnchor(userInfo);

      // 2. Clear existing posts for a clean re-fetch
      await this.db.posts.where('uploader_id').equals(uploaderId).delete();

      // 3. Sequential cursor-based fetch (ascending by ID, 200 per batch)
      const limit = 200;
      let page = `a${anchor}`;
      let hasMore = true;
      let no = 0;
      let firstResponseAt: number | null = null;

      while (hasMore) {
        perfLogger.start('dbi:db:sync:quick:page');
        const pageIndex = perfStats.pages;

        const params = new URLSearchParams({
          tags: `user:${normalizedName}`,
          limit: String(limit),
          page,
          only: SYNC_POST_FIELDS,
        });
        const url = `/posts.json?${params.toString()}`;

        reportProgress(no, total, `Fetching posts (${no}/${total})...`);

        const resp = await this.rateLimiter.fetch(url);
        firstResponseAt ??= responseServerTime(resp, Date.now());
        const batch: DanbooruPost[] = await resp.json();

        if (!Array.isArray(batch) || batch.length === 0) {
          perfLogger.end('dbi:db:sync:quick:page', {
            page: pageIndex,
            cursor: page,
            fetched: 0,
            empty: true,
          });
          hasMore = false;
          break;
        }

        // Ensure ascending order (oldest first)
        if (batch.length > 1 && batch[0].id > batch[batch.length - 1].id) {
          batch.reverse();
        }

        // Store batch with sequential no values
        const bulkData = batch.map((p: DanbooruPost) => toPostRecord(p, ++no));

        perfLogger.start('dbi:db:sync:quick:bulkPut');
        await bulkPutSafe(this.db.posts, bulkData, () =>
          evictOldestNonCurrentUser(this.db, uploaderId),
        );
        perfLogger.end('dbi:db:sync:quick:bulkPut', {count: bulkData.length});

        reportProgress(no, total);

        perfStats.pages++;
        perfStats.writtenPosts += bulkData.length;
        perfLogger.end('dbi:db:sync:quick:page', {
          page: pageIndex,
          cursor: page,
          fetched: batch.length,
        });

        if (batch.length < limit) {
          hasMore = false;
        } else {
          page = `a${batch[batch.length - 1].id}`;
        }
      }

      // 4. Save last sync timestamp
      const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
      localStorage.setItem(lastSyncKey, new Date().toISOString());

      // 4b. Every row was rewritten from the first post on, with fields
      // version 2 (T-402): no backfill needed.
      await this.recordFullSyncMeta(uploaderId, firstResponseAt ?? Date.now());

      // 5. Other users' stale data: the app cleans it after the dashboard
      // is painted (T-503).

      // 6. Signal UI: Processing Stats
      reportProgress(no, no, 'PREPARING');

      // 7. Refresh critical stats (full sync). Heavy tag distributions
      // freshen post-paint via fetchDashboardData's SWR revalidate.
      this.forgetLocalRows(uploaderId);
      await this.refreshCriticalStats(userInfo, true);

      // Engagement signal — see syncAllPosts for rationale.
      await requestPersistence();
    } finally {
      perfLogger.end('dbi:db:sync:quick:total', perfStats);
      AnalyticsDataManager.isGlobalSyncing = false;
      AnalyticsDataManager.onProgressCallback = null;
    }
  }

  /**
   * Cleans up data for other users if they haven't been synced in 14 days.
   * Run by the app after a sync, once its dashboard is painted (T-503):
   * inside the sync it held the dashboard back while it deleted.
   * @param {number|string} currentUserId - The ID of the currently active user (to skip).
   */
  async cleanupStaleData(currentUserId: number | string): Promise<void> {
    const currentId =
      typeof currentUserId === 'number'
        ? currentUserId
        : parseInt(currentUserId);
    const THRESHOLD = CONFIG.ANALYTICS_CLEANUP_THRESHOLD_MS;
    const now = new Date().getTime();

    try {
      // 1. Get all unique uploader_ids from DB
      // Dexie doesn't have a direct 'distinct' query efficiently without keys.
      // But we can iterate unique keys if indexed? 'uploader_id' is indexed.
      const allIds = await this.db.posts.orderBy('uploader_id').uniqueKeys();

      for (const uid of allIds) {
        if (uid === currentId) continue; // Skip current user

        const syncKey = `danbooru_grass_last_sync_${uid}`;
        const lastSyncStr = localStorage.getItem(syncKey);
        const meta = await readSyncMeta(this.db, uid as number);

        // No stamp and no recent sync start: zombie rows. A sync that
        // started recently but did not complete keeps its rows (T-404).
        const shouldDelete = isStaleUser(
          lastSyncStr ? new Date(lastSyncStr).getTime() : null,
          meta?.syncStartedAt,
          now,
          THRESHOLD,
        );

        if (shouldDelete) {
          // Keys from the index, then one bulk delete (T-503): a
          // collection delete walks a cursor over every row.
          const keys = await this.db.posts
            .where('uploader_id')
            .equals(uid)
            .primaryKeys();
          await this.db.posts.bulkDelete(keys);
          await this.db.piestats.where('userId').equals(uid).delete();
          // The rest of what this user left (T-505): its sync state (keyed
          // by the number) and its counters (keyed by the string).
          await this.db.sync_meta?.delete(uid as number);
          await this.db.user_stats?.delete(String(uid));

          localStorage.removeItem(syncKey);
        }
      }
    } catch (e: unknown) {
      log.warn('Stale data cleanup failed', {error: e});
    }
    // The user dashboard writes implication rows too; without this they were
    // only pruned by a tag page's daily sweep (T-505, from T-309).
    await pruneImplicationCache(this.db, now);
  }

  /**
   * Refreshes the *critical* cached statistics for the user — the ones the
   * dashboard must show fresh on the very first paint after a sync:
   * status/rating counts, milestones, level history, and top/recent popular
   * posts. Cheap set (~18 API calls, ~2-3s) so it stays on the blocking sync
   * path.
   *
   * The heavy tag-distribution + tag-cloud fetchers (character/copyright/
   * fav-copyright/breasts/hair×2 + 4 tag clouds, ~130-260 calls) are
   * DELIBERATELY NOT refreshed here. Adding a handful of posts barely moves a
   * top-10 distribution, so those render from the previous sync's piestats
   * cache and freshen in the background via `fetchDashboardData`'s SWR
   * revalidate (post-paint) — see [user-analytics-data.ts]. This is what took
   * the post-sync dashboard open from ~30s down to ~3-6s (audit H-2 / R2).
   *
   * `getRandomPosts` was also dropped: the dashboard fetches its own random
   * pick fresh on every open, so warming it here was pure waste (audit L-1).
   *
   * @param {Object} userInfo The user's info object.
   * @return {Promise<void>}
   */
  async refreshCriticalStats(
    userInfo: TargetUser,
    isFullSync: boolean = false,
  ): Promise<void> {
    perfLogger.start('dbi:db:refresh:total');
    try {
      await Promise.all([
        perfLogger.wrap('dbi:db:refresh:status', () =>
          this.getStatusDistribution(userInfo, null, true),
        ),
        perfLogger.wrap('dbi:db:refresh:rating', () =>
          this.getRatingDistribution(userInfo, null, true),
        ),
        // Warm the level-change-history cache on every sync — the dashboard
        // always reads it, and the API is cheap (no per-user search
        // combinatorics).
        perfLogger.wrap('dbi:db:refresh:levelChanges', () =>
          this.getLevelChangeHistory(userInfo, true),
        ),
        // Warm the milestones cache for the step=1000 view that renderDashboard
        // always requests. Both NSFW values so toggling is a cache hit too —
        // NSFW first: its thumbnail lookup covers every milestone row, so the
        // SFW pass finds them filled instead of asking for the same posts
        // (T-506).
        (async () => {
          await perfLogger.wrap('dbi:db:refresh:milestonesNsfw', () =>
            this.getMilestones(userInfo, true, 1000, true),
          );
          await perfLogger.wrap('dbi:db:refresh:milestonesSfw', () =>
            this.getMilestones(userInfo, false, 1000, true),
          );
        })(),
        // Popular posts are API-driven (order:score, age:<1w) and cached in
        // piestats. Refresh on EVERY sync — a partial (incremental) sync must
        // freshen them too, otherwise the post-sync dashboard render serves
        // the pre-sync cache. (Previously gated to full sync only, which left
        // large users' Recent/Most Popular stale after every re-sync.)
        perfLogger.wrap('dbi:db:refresh:topPostsByType', () =>
          this.getTopPostsByType(userInfo, true),
        ),
        perfLogger.wrap('dbi:db:refresh:recentPopular', () =>
          this.getRecentPopularPosts(userInfo, true),
        ),
      ]);
    } catch (e: unknown) {
      log.warn('Failed to refresh critical stats', {error: e});
    } finally {
      perfLogger.end('dbi:db:refresh:total', {isFullSync});
    }
  }

  /**
   * Clears all analytics data for the specified user from local DB.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<void>}
   */
  async clearUserData(userInfo: TargetUser): Promise<void> {
    if (!userInfo.id) return;
    const uploaderId = parseInt(userInfo.id ?? '0'); // For tables using Integers (API direct)

    // 1. Delete posts (uploader_id is INT)
    await this.db.posts.where('uploader_id').equals(uploaderId).delete();

    // 2. Delete Pie Stats (userId is INT in updatePieStats)
    await this.db.piestats.where('userId').equals(uploaderId).delete();

    // 3. Sync state describes the rows just deleted (fields version,
    // watermark, a backfill plan): left behind, it would vouch for whatever
    // the next, possibly partial, sync writes.
    await this.db.sync_meta?.delete(uploaderId);
    // Its gentags / tagcount counters (T-505); keyed by the string id.
    await this.db.user_stats?.delete(userInfo.id);
    this.forgetLocalRows(uploaderId);

    // Clear metadata (Last Sync Time)
    const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
    localStorage.removeItem(lastSyncKey);

    // The old backfill-complete flag (no longer read since T-403, which
    // keys the backfill on sync_meta.fieldsVersion) is dropped with the rows.
    localStorage.removeItem(`di_post_metadata_v2_${uploaderId}`);
  }
}
