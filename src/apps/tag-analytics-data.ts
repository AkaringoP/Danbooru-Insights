import {CONFIG, DAY_MS} from '../config';
import {
  buildUntaggedTranslationQueries,
  computeUntaggedTranslation,
} from '../core/analytics-data-manager';
import {fetchRemoteCount} from '../core/data-manager';
import {createLogger} from '../core/logger';
import {
  MONTHLY_REPORT_FROM,
  buildMonthlyReportUrl,
  defaultReportTo,
  mergeMonthlyCounts,
  monthKeysBetween,
  parseMonthlyReport,
  splitReportRange,
  trimMonthlyCounts,
  utcDateString,
  type MonthlyCounts,
} from '../core/monthly-report';
import {bulkPutSafe, evictOldestNonCurrentUser} from '../core/quota-manager';
import {RateLimitedFetch} from '../core/rate-limiter';
import {getTopLevelFlags} from '../core/top-level-tags';
import type {Database} from '../core/database';
import type {
  DanbooruPost,
  DanbooruTag,
  DanbooruUser,
  DanbooruRelatedTag,
  DanbooruRelatedTagResponse,
  HistoryEntry,
  MilestoneEntry,
  UserRanking,
  TagAnalyticsMeta,
  MonthlyCountRecord,
} from '../types';

/**
 * `fetchMonthlyCounts`'s history. `partial`: some month's count was lost
 * and reads as 0 in it, so the history must not be cached (G-4).
 */
type MonthlyCountsData = HistoryEntry[] & {partial?: boolean};

/** A tag's monthly history from {@link TagAnalyticsDataService.fetchMonthlyHistory}. */
export type MonthlyHistory = {
  /** Consecutive UTC months from the first one with posts, running total. */
  history: HistoryEntry[];
  /**
   * How it was fetched: 1 one report for the whole range, 2 the range in
   * pieces (or a remainder after cached months), 3 one count per month.
   */
  layer: 1 | 2 | 3;
  /** Some month was lost (layer 3 only): show it, but do not cache it. */
  partial: boolean;
};

/**
 * Reports a monthly history may cost before it falls back to one count per
 * month (layer 3). The first, whole-range request counts.
 */
export const REPORT_HISTORY_MAX_REQUESTS = 24;

/** The smallest piece a timed-out report range is split into, in months. */
const REPORT_HISTORY_MIN_SPLIT_MONTHS = 12;

/**
 * Whether a cached tag report's history is in UTC months (`historyBasis`).
 * Records saved before T-302 counted months in the viewer's time zone (and
 * could hold a lost month as 0); their history and the tag's monthly count
 * cache are dropped once rather than mixed with UTC months (PLAN.md 4.2).
 */
export function hasUtcHistory(
  meta: Pick<TagAnalyticsMeta, 'historyBasis'> | null | undefined,
): boolean {
  return meta?.historyBasis === 'utc';
}

/** Milestone posts fetched at a time (the shared limiter paces them). */
const MILESTONE_CONCURRENCY = 3;

/**
 * Numbered pages every viewer may ask for: Danbooru answers 410 past
 * `User.page_limit` (1000 below Gold, 5000 from Gold).
 */
const MILESTONE_MAX_PAGE = 1000;

/** Where to find one milestone post: the search, the page, the row. */
export type MilestoneLookup = {
  milestone: number;
  /** `<tag> status:any date:>=<UTC month start> order:id`. */
  query: string;
  limit: number;
  page: number;
  /** Zero-based row of the post on that page. */
  index: number;
};

/**
 * Where the `target`-th post of the tag is (T-304): the month the running
 * total reaches it, then its place among that month's posts in id order.
 *
 * - The month starts at its UTC instant, like the history's months. The
 *   old `date:>` the previous month's last day was a bare date (read in the
 *   viewer's time zone) and let that day's posts in, so the post found was
 *   ahead of the milestone by them.
 * - The page size grows with the offset, `limit = ceil(offset / 1000)` up
 *   to 200, so the page number stays within 1000 — the page limit of every
 *   account level — up to 200,000 posts into the month.
 *
 * Null when the history never reaches `target`, or the post would lie past
 * that page limit.
 */
export function milestoneLookup(
  tagName: string,
  history: HistoryEntry[],
  target: number,
): MilestoneLookup | null {
  let prevCumulative = 0;
  const month = history.find(m => {
    if (m.cumulative >= target) return true;
    prevCumulative = m.cumulative;
    return false;
  });
  if (!month) return null;

  const offset = target - prevCumulative;
  const limit = Math.min(200, Math.max(1, Math.ceil(offset / 1000)));
  const page = Math.ceil(offset / limit);
  if (page > MILESTONE_MAX_PAGE) return null;
  return {
    milestone: target,
    query: `${tagName} status:any date:>=${month.date.slice(0, 7)}-01T00:00:00Z order:id`,
    limit,
    page,
    index: (offset - 1) % limit,
  };
}

/**
 * Reads a grouped report (`search[group]` without `search[period]`): rows
 * like `{rating: "g", posts: 12}` or `{is_deleted: true, posts: 3}`, one
 * per value that has posts. Keys are the values as strings. Throws on
 * anything but such a list, so a broken reply is never read as zeros.
 */
export function parseGroupReport(
  body: unknown,
  column: string,
): Map<string, number> {
  if (!Array.isArray(body)) throw new Error('Group report is not a list');
  const counts = new Map<string, number>();
  for (const row of body as unknown[]) {
    const r = (row ?? {}) as Record<string, unknown>;
    const value = r[column];
    const posts = r['posts'];
    if (
      (typeof value !== 'string' && typeof value !== 'boolean') ||
      typeof posts !== 'number' ||
      !Number.isInteger(posts) ||
      posts < 0
    ) {
      throw new Error(`Group report row unreadable: ${JSON.stringify(row)}`);
    }
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + posts);
  }
  return counts;
}

/** A report request that came back with an HTTP error. */
class ReportStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'ReportStatusError';
  }
}

/**
 * Whether a failed report is worth asking for again in smaller pieces: the
 * server ran out of time (Danbooru answers a statement timeout with 500)
 * or a gateway in front of it did.
 */
function isReportTimeout(e: unknown): boolean {
  return e instanceof ReportStatusError && e.status >= 500;
}

export type InitialStats = {
  firstPost?: DanbooruPost;
  hundredthPost?: DanbooruPost | null;
  totalCount: number;
  startDate?: Date;
  timeToHundred?: number | null;
  meta: DanbooruTag;
  initialPosts?: DanbooruPost[] | null;
  updatedAt?: number;
  /** Cached first-100 stats for delta sync path. */
  first100Stats?: LocalStats;
};

export type LocalStats = {
  ratingCounts: Record<string, number>;
  uploaderRanking: UserRanking[];
  approverRanking: UserRanking[];
};

type ReportEntry = {
  id?: number | string;
  name?: string;
  uploader?: string;
  approver?: string;
  user?: string;
  posts?: number;
  count?: number;
  post_count?: number;
};

export type RankingResult = {
  uploaderAll: UserRanking[];
  approverAll: UserRanking[];
  uploaderYear: UserRanking[];
  approverYear: UserRanking[];
  /**
   * Slots whose report could not be fetched (a 429, 5xx, network error or
   * an error body). Their list is empty, which here means "unknown", not
   * "nobody": see {@link keepCachedOnFailure}.
   */
  failed?: RankingSlot[];
};

/** One of the four report rankings in a {@link RankingResult}. */
type RankingSlot =
  | 'uploaderAll'
  | 'approverAll'
  | 'uploaderYear'
  | 'approverYear';

const RANKING_SLOTS: readonly RankingSlot[] = [
  'uploaderAll',
  'approverAll',
  'uploaderYear',
  'approverYear',
];

/**
 * `fresh` with each failed slot filled from `cached`, so a report that
 * failed never replaces a ranking that was there (the empty list would be
 * shown and then saved for a day). A failed slot with nothing cached stays
 * empty and stays listed in `failed`.
 */
export function keepCachedOnFailure(
  fresh: RankingResult,
  cached: Omit<RankingResult, 'failed'> | null,
): RankingResult {
  if (!fresh.failed?.length) return fresh;
  const out: RankingResult = {...fresh};
  const stillFailed: RankingSlot[] = [];
  for (const slot of fresh.failed) {
    const previous = cached?.[slot];
    if (previous) out[slot] = previous;
    else stillFailed.push(slot);
  }
  if (stillFailed.length > 0) out.failed = stillFailed;
  else delete out.failed;
  return out;
}

/** The report rankings saved with a cached tag report, or null. */
export function cachedRankingResult(
  meta: Pick<TagAnalyticsMeta, 'rankings'> | null | undefined,
): RankingResult | null {
  const r = meta?.rankings;
  if (!r) return null;
  return {
    uploaderAll: r.uploader?.allTime,
    approverAll: r.approver?.allTime,
    uploaderYear: r.uploader?.year,
    approverYear: r.approver?.year,
  };
}

type UserEntry = {name: string; level: string};
type UserEntryWithId = {id: number; name: string; level: string};

const log = createLogger('TagAnalyticsData');

// ---------------------------------------------------------------------------
// Monthly count cache TTL (pure, exported for testing)
// ---------------------------------------------------------------------------

/** Milliseconds per day — local copy so TTL logic stays self-contained. */
const CACHE_DAY_MS = 24 * 60 * 60 * 1000;

/** Drift threshold above which cached monthly sums force a cache invalidation. */
export const MONTHLY_CACHE_DRIFT_THRESHOLD = 0.02;

/** Interval after which a full rescan is forced regardless of per-month TTL. */
export const MONTHLY_CACHE_FULL_RESCAN_MS = 90 * CACHE_DAY_MS;

/**
 * Distance in whole months from `yearMonth` (`YYYY-MM`) to `now`.
 * Returns 0 for the current month, 1 for last month, and so on. Negative
 * values (future months) should not occur in practice but are handled.
 */
export function computeMonthsDistance(
  yearMonth: string,
  now: Date = new Date(),
): number {
  const [y, m] = yearMonth.split('-').map(Number);
  return (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
}

/**
 * Distance-based TTL for monthly count cache entries.
 *   0–1 months old: always stale (Delta sync owns this window)
 *   2–12 months: 7 days
 *   13–36 months: 30 days
 *   37+ months: 180 days
 */
export function isMonthlyCountValid(
  yearMonth: string,
  fetchedAt: number,
  now: number,
): boolean {
  const distance = computeMonthsDistance(yearMonth, new Date(now));
  if (distance <= 1) return false;
  const age = now - fetchedAt;
  if (age < 0) return false;
  if (distance <= 12) return age < 7 * CACHE_DAY_MS;
  if (distance <= 36) return age < 30 * CACHE_DAY_MS;
  return age < 180 * CACHE_DAY_MS;
}

// ---------------------------------------------------------------------------
// Related-tag distribution: approximation + SWR helpers
// ---------------------------------------------------------------------------

/** Minimum total frequency to emit an "Others" slice (0.5%). */
export const DISTRIBUTION_OTHERS_MIN_FREQ = 0.005;

/** Cumulative frequency cutoff where we stop emitting individual slices. */
export const DISTRIBUTION_CUTOFF_FREQ = 0.95;

/** Top-N candidates kept after top-level filtering, capped to what the UI needs. */
export const DISTRIBUTION_TOP_N = 10;

/** Shape of a single slice returned by `buildDistributionApprox`. */
export interface DistributionSlice {
  /** Display name (underscores replaced with spaces). */
  name: string;
  /** Raw tag name (underscored); `"others"` for the residual slice. */
  key: string;
  /** 0..1 frequency from `/related_tag.json`. */
  frequency: number;
  /** Approximate post count (`frequency × totalCount`, rounded down). */
  count: number;
  /** Present + true only for the residual aggregate slice. */
  isOther?: boolean;
}

/**
 * Builds the sorted top-10 distribution with approximate counts + "Others"
 * cutoff. Pure / exported for testing.
 *
 * Counts are derived as `frequency × totalCount`; the exact per-combination
 * `/counts/posts.json` query is deferred to `revalidateRelatedTagCounts`
 * (SWR pattern) so initial render never blocks on 10 serial-rate-limited
 * requests.
 */
export function buildDistributionApprox(
  filteredCandidates: DanbooruRelatedTag[],
  totalCount: number,
): DistributionSlice[] {
  // Sort defensively before slicing to top-N — the production caller
  // receives already-sorted input from /related_tag.json, but we don't
  // want correctness to rely on that assumption.
  const getFreq = (c: DanbooruRelatedTag): number =>
    c.related_tag ? c.related_tag.frequency : c.frequency || 0;
  const sorted = [...filteredCandidates].sort(
    (a, b) => getFreq(b) - getFreq(a),
  );

  const topTags: DistributionSlice[] = sorted
    .slice(0, DISTRIBUTION_TOP_N)
    .map(item => {
      const freq = getFreq(item);
      return {
        name: item.tag.name.replace(/_/g, ' '),
        key: item.tag.name,
        frequency: freq,
        count: Math.max(0, Math.floor(freq * Math.max(0, totalCount))),
      };
    });

  const finalTags: DistributionSlice[] = [];
  let currentSumFreq = 0;
  for (const t of topTags) {
    finalTags.push(t);
    currentSumFreq += t.frequency;
    if (currentSumFreq > DISTRIBUTION_CUTOFF_FREQ) break;
  }

  // Only emit "Others" when there's at least one real slice to be "other"
  // relative to — a zero-candidate input should yield an empty list, not
  // a single all-encompassing Others slice.
  if (finalTags.length > 0) {
    const remainFreq = Math.max(0, 1 - currentSumFreq);
    if (remainFreq > DISTRIBUTION_OTHERS_MIN_FREQ) {
      const othersCount = Math.floor(Math.max(0, totalCount) * remainFreq);
      if (othersCount > 0) {
        finalTags.push({
          name: 'Others',
          key: 'others',
          frequency: remainFreq,
          count: othersCount,
          isOther: true,
        });
      }
    }
  }

  return finalTags;
}

/** Collapses distribution slices into the `{tag: count}` shape the pie chart expects. */
export function distributionToCountMap(
  slices: DistributionSlice[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const s of slices) {
    result[s.key] = s.count;
  }
  return result;
}

/**
 * Data service for TagAnalyticsApp.
 * Handles all API fetching, caching, and data computation.
 */
export class TagAnalyticsDataService {
  db: Database;
  rateLimiter: RateLimitedFetch;
  tagName: string;
  userNames: Record<
    string,
    {name: string; level: string; id?: number | string}
  >;

  /**
   * Stash for `lastFullScanAt` to be merged into the next `saveToCache`
   * call. Set by `fetchMonthlyCounts` when a full rescan completes and
   * the tag_analytics record does not yet exist (first visit).
   */
  private _pendingLastFullScanAt: number | null = null;

  /**
   * v9.6: stash for `countsUpdatedAt`. Set by `markCountsRefreshed()`
   * whenever statusCounts/ratingCounts are freshly fetched (initial
   * Phase 3 or TTL refresh in `_checkCache`). Reset to null after save
   * so volatile-data-only saves preserve the existing timestamp.
   */
  private _pendingCountsUpdatedAt: number | null = null;

  /**
   * v9.6: marks the count overlays (statusCounts + ratingCounts) as
   * freshly fetched. The next `saveToCache` stamps the record's
   * `countsUpdatedAt` with this moment.
   */
  markCountsRefreshed(): void {
    this._pendingCountsUpdatedAt = Date.now();
  }

  /**
   * Per-session memo for `/tags.json` responses. A single analysis run
   * calls `fetchTagData` from up to four paths (run, _checkCache,
   * fetchInitialStats, and the backward-scan retry), each costing ~300ms.
   * Memoizing eliminates the redundant calls; the 5-minute TTL keeps the
   * value fresh enough that `post_count` diffs still catch new uploads.
   */
  private _tagDataMemo = new Map<
    string,
    {value: DanbooruTag | null; ts: number}
  >();
  private readonly _tagDataTTL = 5 * 60 * 1000;

  constructor(db: Database, rateLimiter: RateLimitedFetch, tagName: string) {
    this.db = db;
    this.rateLimiter = rateLimiter;
    this.tagName = tagName;
    this.userNames = {};
  }

  /**
   * Loads the tag analytics report from the cache if not expired.
   * Cache is considered stale after 24 hours.
   *
   * A report saved before histories were UTC months (no `historyBasis`) is
   * not used: the analysis runs again, and this tag's monthly count rows go
   * with it, so viewer-time-zone months never mix with UTC ones (T-303).
   *
   * @return {Promise<?Object>} The cached data object or null if not found/expired.
   */
  async loadFromCache(): Promise<TagAnalyticsMeta | null> {
    if (!this.db || !this.db.tag_analytics) return null;
    try {
      const cached = await this.db.tag_analytics.get(this.tagName);
      if (cached && !hasUtcHistory(cached.data)) {
        log.debug('Cached report predates UTC history, refetching', {
          tag: this.tagName,
        });
        await this.invalidateMonthlyCountsCache();
        return null;
      }
      if (cached) {
        // Check expiry (e.g. 24 hours)
        const age = Date.now() - cached.updatedAt;
        if (age < CONFIG.CACHE_EXPIRY_MS) {
          return {
            ...cached.data,
            updatedAt: cached.updatedAt,
            // Surface countsUpdatedAt from the cache record so the app
            // layer can decide whether the deferred count overlays
            // (statusCounts / ratingCounts) need a TTL refresh.
            countsUpdatedAt: cached.countsUpdatedAt,
          };
        }
      }
    } catch (e) {
      log.warn('Cache load failed', {error: e});
    }
    return null;
  }

  /**
   * Saves the current tag analytics data to the cache with a timestamp.
   * @param {!Object} data The analytics data to cache.
   * @return {Promise<void>}
   */
  async saveToCache(data: TagAnalyticsMeta): Promise<void> {
    if (!this.db || !this.db.tag_analytics) return;
    try {
      // Preserve `lastFullScanAt` and `countsUpdatedAt` across saves:
      // the lifecycle stash (set by the most recent fresh fetch) wins,
      // otherwise fall back to whatever the existing record holds so
      // volatile-data-only saves don't wipe these metadata fields.
      const needExisting =
        this._pendingLastFullScanAt === null ||
        this._pendingCountsUpdatedAt === null;
      const existing = needExisting
        ? await this.db.tag_analytics.get(this.tagName)
        : null;

      const lastFullScanAt: number | undefined =
        this._pendingLastFullScanAt !== null
          ? this._pendingLastFullScanAt
          : existing?.lastFullScanAt;
      const countsUpdatedAt: number | undefined =
        this._pendingCountsUpdatedAt !== null
          ? this._pendingCountsUpdatedAt
          : existing?.countsUpdatedAt;

      await this.db.tag_analytics.put({
        tagName: this.tagName,
        updatedAt: Date.now(),
        data: data,
        lastFullScanAt,
        countsUpdatedAt,
      });
      this._pendingLastFullScanAt = null;
      this._pendingCountsUpdatedAt = null;
    } catch (e) {
      log.warn('Cache save failed', {error: e});
    }
  }

  /**
   * Bulk-reads monthly count cache entries for this tag.
   * Returns a Map keyed by `yearMonth` (missing entries are simply absent).
   * Rows from before UTC months (no `basis`) count as missing.
   */
  private async readMonthlyCountsCache(
    yearMonths: string[],
  ): Promise<Map<string, MonthlyCountRecord>> {
    const result = new Map<string, MonthlyCountRecord>();
    if (!this.db?.tag_monthly_counts || yearMonths.length === 0) return result;
    try {
      const keys = yearMonths.map(ym => [this.tagName, ym] as [string, string]);
      const records = await this.db.tag_monthly_counts.bulkGet(keys);
      records.forEach((r, i) => {
        if (r?.basis === 'utc') result.set(yearMonths[i], r);
      });
    } catch (e) {
      log.warn('Failed to read monthly counts cache', {error: e});
    }
    return result;
  }

  /**
   * Bulk-writes fetched monthly counts into the cache.
   * `fetchedAt` is stamped once for the whole batch.
   */
  private async writeMonthlyCountsCache(
    entries: Array<{yearMonth: string; count: number}>,
  ): Promise<void> {
    if (!this.db?.tag_monthly_counts || entries.length === 0) return;
    try {
      const now = Date.now();
      const records: MonthlyCountRecord[] = entries.map(e => ({
        tag: this.tagName,
        yearMonth: e.yearMonth,
        count: e.count,
        fetchedAt: now,
        basis: 'utc',
      }));
      // Tag pages have no current-user context; pass `0` so the evictor
      // can pick any user's posts as the LRU victim if quota is hit.
      await bulkPutSafe(this.db.tag_monthly_counts, records, () =>
        evictOldestNonCurrentUser(this.db!, 0),
      );
    } catch (e) {
      log.warn('Failed to write monthly counts cache', {error: e});
    }
  }

  /**
   * Top-level flags for `tagNames` via the shared cache + batch pipeline in
   * core/top-level-tags. Public so `TagAnalyticsApp._fetchPostTags` can use
   * it for its copyright-candidate filter.
   */
  async getTopLevelFlags(tagNames: string[]): Promise<Map<string, boolean>> {
    return getTopLevelFlags(this.rateLimiter, this.db, tagNames);
  }

  /** Drops every cached monthly count for this tag (drift invalidation). */
  private async invalidateMonthlyCountsCache(): Promise<void> {
    if (!this.db?.tag_monthly_counts) return;
    try {
      await this.db.tag_monthly_counts
        .where('tag')
        .equals(this.tagName)
        .delete();
    } catch (e) {
      log.warn('Failed to invalidate monthly counts cache', {error: e});
    }
  }

  /**
   * Persists the "last full scan" timestamp for this tag.
   * Updates the existing tag_analytics record in place if present; otherwise
   * stashes into `_pendingLastFullScanAt` for the next `saveToCache` call.
   */
  private async persistFullScanMarker(ts: number): Promise<void> {
    if (!this.db?.tag_analytics) return;
    try {
      const existing = await this.db.tag_analytics.get(this.tagName);
      if (existing) {
        existing.lastFullScanAt = ts;
        await this.db.tag_analytics.put(existing);
      } else {
        this._pendingLastFullScanAt = ts;
      }
    } catch (e) {
      log.warn('Failed to persist full scan marker', {error: e});
    }
  }

  /**
   * Gets the retention period for tag analytics caches from localStorage.
   * @return {number} Number of days to keep cache (default: 7).
   */
  getRetentionDays(): number {
    try {
      const val = localStorage.getItem('danbooru_tag_analytics_retention');
      if (val) return parseInt(val, 10);
    } catch {
      // Fallback to default
    }
    return 7;
  }

  /**
   * Gets the sync threshold (new posts) for triggering partial sync.
   * @return {number} Number of new posts (default: 50).
   */
  getSyncThreshold(): number {
    try {
      const val = localStorage.getItem('danbooru_tag_analytics_sync_threshold');
      if (val) return parseInt(val, 10);
    } catch {
      // Fallback
    }
    return 50;
  }

  /**
   * Sets the sync threshold.
   * @param {number} count The threshold.
   */
  setSyncThreshold(count: number): void {
    localStorage.setItem(
      'danbooru_tag_analytics_sync_threshold',
      count.toString(),
    );
  }
  /**
   * Sets the retention period for tag analytics caches in localStorage.
   * @param {number} days Number of days to keep cache.
   */
  setRetentionDays(days: number): void {
    if (typeof days === 'number' && days > 0) {
      localStorage.setItem('danbooru_tag_analytics_retention', String(days));
    }
  }

  /**
   * Wipes every per-tag cache entry for the tag this service was constructed
   * for — the tag_analytics record itself and all tag_monthly_counts rows.
   * Leaves the global `tag_implications_cache` alone (it's TTL-managed and
   * shared across tags; evicting it here would penalise unrelated lookups).
   *
   * Called by the "reset data" UI button. After this runs, the next
   * analytics request for the tag performs a full fresh sync — no auto
   * re-fetch inside this call (by design; matches UserAnalyticsApp's
   * reset UX where the user explicitly re-triggers the sync).
   */
  async resetTagCache(): Promise<void> {
    if (!this.db) return;
    if (this.db.tag_analytics) {
      await this.db.tag_analytics.delete(this.tagName);
    }
    await this.invalidateMonthlyCountsCache();
    // Reset session state so a later re-open within the same page load
    // doesn't carry stale scan markers or user name lookups.
    this._pendingLastFullScanAt = null;
    this.userNames = {};
  }

  /**
   * Deletes tag analytics cache entries older than the retention threshold.
   * @return {Promise<void>}
   */
  async cleanupOldCache(): Promise<void> {
    if (!this.db || !this.db.tag_analytics) return;

    const retentionDays = this.getRetentionDays();
    const cutoff = Date.now() - retentionDays * DAY_MS;

    try {
      await this.db.tag_analytics.where('updatedAt').below(cutoff).delete();
    } catch (e) {
      log.warn('Cleanup failed', {error: e});
    }
  }

  /**
   * Fetches initialization statistics for a tag (First post, 100th post, Total count).
   * This defines the scope of data to fetch.
   *
   * @param {string} tagName - The tag to analyze.
   * @param {?Object} cachedData - Existing cached data to serve as a base for delta updates.
   * @param {boolean} absoluteOldest - If true, forces a scan from 2005-01-01 (ignoring cache/hints).
   * @param {?string} foundEarliestDate - An optimized starting date (YYYY-MM-DD) found via reverse scan.
   *                                      Used to narrow the search range for recent tags.
   * @return {Promise<Object|null>} - Initial stats object or null on failure.
   */
  // T-26 baseline: complexity 31. Cache/hint/cold-start branches × full vs
  // delta paths × tag-category routing. Stable critical path.
  // eslint-disable-next-line complexity
  async fetchInitialStats(
    tagName: string,
    cachedData?: TagAnalyticsMeta | null,
    absoluteOldest?: boolean,
    foundEarliestDate?: string | null,
  ): Promise<InitialStats | null> {
    // Get Tag Metadata first to know count and category
    const tagData = await this.fetchTagData(tagName); // Existing helper
    if (!tagData) return null;

    // [DELTA] Use Cached First 100 Data if available
    if (cachedData && cachedData.firstPost) {
      return {
        firstPost: cachedData.firstPost,
        hundredthPost: cachedData.hundredthPost,
        totalCount: tagData.post_count,
        startDate: new Date(cachedData.firstPost.created_at),
        timeToHundred: cachedData.timeToHundred,
        meta: tagData,
        initialPosts: null, // We don't have them in full if cached, but we don't need them for delta
      };
    }

    // Extract created_at from tagData
    // If absoluteOldest is true, we ignore created_at to find history hidden by renames
    // If foundEarliestDate is provided (from Reverse Scan), use it as a strong hint!

    let tagCreatedAt = tagData.created_at;
    if (foundEarliestDate) {
      tagCreatedAt = foundEarliestDate;
    } else if (absoluteOldest) {
      tagCreatedAt = '2005-01-01';
    }

    let posts: DanbooruPost[] = [];
    const MAX_OPTIMIZED_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
    const isSmallTag = tagData.post_count <= MAX_OPTIMIZED_POSTS;
    const targetFetchCount = Math.min(tagData.post_count, MAX_OPTIMIZED_POSTS);
    const limit = isSmallTag ? 200 : 100; // Small tag = batch up to 200, Large tag = only need first 100
    let currentPage = 'a0'; // After ID 0 (ascending)
    let hasMore = true;

    try {
      // Fetch up to targetCount (max 1200) posts sequentially.
      while (hasMore && posts.length < targetFetchCount) {
        const fetchLimit = Math.min(limit, targetFetchCount - posts.length);
        const params = new URLSearchParams({
          tags: `${tagName} date:>=${tagCreatedAt}`,
          limit: String(fetchLimit),
          page: currentPage,
          only: 'id,created_at,uploader_id,approver_id,file_url,preview_file_url,variants,rating,score,tag_string_copyright,tag_string_character',
        });
        const url = `/posts.json?${params.toString()}`;

        const batch = await this.rateLimiter
          .fetch(url)
          .then((r: Response) => r.json());

        if (!Array.isArray(batch) || batch.length === 0) {
          break;
        }

        if (batch.length > 1) {
          // Check order. We want Ascending (Oldest First).
          if (batch[0].id > batch[batch.length - 1].id) {
            batch.reverse();
          }
        }

        posts = posts.concat(batch);

        if (
          batch.length < fetchLimit ||
          posts.length >= targetFetchCount ||
          !isSmallTag
        ) {
          hasMore = false; // Stop fetching
        } else {
          // Setup for next page
          currentPage = `a${batch[batch.length - 1].id}`;
        }
      }

      // Fix for Small Tags: If optimization failed to get all posts (due to renames/merges filtering by date),
      // and it's a small tag (<=1200), re-fetch absolute oldest without date filter.
      if (isSmallTag && posts.length < targetFetchCount) {
        posts = [];
        currentPage = 'a0';
        hasMore = true;

        while (hasMore && posts.length < targetFetchCount) {
          const fetchLimit = Math.min(limit, targetFetchCount - posts.length);
          const fbParams = new URLSearchParams({
            tags: `${tagName}`,
            limit: String(fetchLimit),
            page: currentPage,
            only: 'id,created_at,uploader_id,approver_id,file_url,preview_file_url,variants,rating,score,tag_string_copyright,tag_string_character',
          });
          const fbBatch = await this.rateLimiter
            .fetch(`/posts.json?${fbParams.toString()}`)
            .then((r: Response) => r.json());

          if (!Array.isArray(fbBatch) || fbBatch.length === 0) {
            break;
          }

          if (
            fbBatch.length > 1 &&
            fbBatch[0].id > fbBatch[fbBatch.length - 1].id
          ) {
            fbBatch.reverse();
          }

          posts = posts.concat(fbBatch);

          if (fbBatch.length < fetchLimit || posts.length >= targetFetchCount) {
            hasMore = false;
          } else {
            currentPage = `a${fbBatch[fbBatch.length - 1].id}`;
          }
        }
      }
    } catch (e) {
      log.warn('Fetch failed for initial stats gather', {error: e});
    }

    if (!posts || posts.length === 0) {
      return {
        totalCount: tagData.post_count,
        meta: tagData,
        updatedAt: Date.now(),
      };
    }

    const firstPost = posts[0];
    const hundredthPost = posts.length >= 100 ? posts[99] : null;

    const startDate = new Date(firstPost.created_at);
    let timeToHundred = null;

    if (hundredthPost) {
      const hundredthDate = new Date(hundredthPost.created_at);
      timeToHundred = hundredthDate.getTime() - startDate.getTime(); // ms
    }

    return {
      firstPost,
      hundredthPost,
      totalCount: tagData.post_count,
      startDate,
      timeToHundred,
      meta: tagData,
      initialPosts: posts, // Can be used for ranking if needed
    };
  }

  /**
   * Fetches `/counts/posts.json` for the given tag query with one bounded
   * retry on transient failure. Returns 0 if both attempts fail.
   *
   * @param tagQuery Unencoded tag query string (e.g. `"foo has:commentary"`).
   * @param retries Number of retries after the first attempt (default 1).
   */
  async fetchCountWithRetry(
    tagQuery: string,
    retries: number = 1,
  ): Promise<number> {
    for (let i = 0; i <= retries; i++) {
      try {
        return await fetchRemoteCount(this.rateLimiter, tagQuery);
      } catch (e) {
        if (i === retries) {
          log.warn(`Failed to fetch count after ${retries + 1} attempts`, {
            tagQuery,
            error: e,
          });
          return 0;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return 0;
  }

  /**
   * Fetches commentary-related counts for a tag (Total, Translated, Requested).
   * @param {string} tagName - The tag to analyze.
   * @return {Promise<Object>} - Object containing counts for 'total', 'translated', and 'requested'.
   */
  async fetchCommentaryCounts(
    tagName: string,
  ): Promise<Record<string, number>> {
    const queries: Record<string, string> = {
      total: `${tagName} has:commentary`,
      translated: `${tagName} has:commentary commentary`,
      requested: `${tagName} has:commentary commentary_request`,
    };

    const results: Record<string, number> = {};

    const keys = Object.keys(queries);
    await Promise.all(
      keys.map(async key => {
        results[key] = await this.fetchCountWithRetry(queries[key]);
      }),
    );

    // [Integrity Check] Ensure all keys exist and are valid numbers
    keys.forEach(key => {
      if (results[key] === undefined) {
        log.warn(`Missing commentary key: ${key}. Defaulting to 0.`);
        results[key] = 0;
      }
    });

    return results;
  }

  /**
   * Fetches translation-related counts for a tag: Translated, Requested,
   * and Untagged. Untagged is computed via the same inclusion-exclusion
   * formula used on the user side (max(0, t − a − b − c + ab + ac)); the
   * 6 subqueries each use ≤2 real tags so Member(Blue) accounts work.
   *
   * @return Object containing counts for 'translated', 'requested', 'untagged'.
   */
  async fetchTranslationCounts(
    tagName: string,
  ): Promise<Record<string, number>> {
    const direct: Record<string, string> = {
      translated: `${tagName} translated`,
      requested: `${tagName} translation_request`,
    };
    const incl = buildUntaggedTranslationQueries(tagName);

    const [translated, requested, t, a, b, c, ab, ac] = await Promise.all([
      this.fetchCountWithRetry(direct.translated),
      this.fetchCountWithRetry(direct.requested),
      this.fetchCountWithRetry(incl.t),
      this.fetchCountWithRetry(incl.a),
      this.fetchCountWithRetry(incl.b),
      this.fetchCountWithRetry(incl.c),
      this.fetchCountWithRetry(incl.ab),
      this.fetchCountWithRetry(incl.ac),
    ]);

    const untagged = computeUntaggedTranslation({t, a, b, c, ab, ac});
    return {translated, requested, untagged};
  }

  /**
   * Posts per value of one report group (`search[group]`) over the tag's
   * whole life (`from` to today). One request through the reports lane
   * instead of one count per value (T-306). Throws on any failure, so the
   * caller can fall back to the counts.
   */
  private async fetchReportGroups(
    tagName: string,
    group: 'rating' | 'is_deleted',
    from: string,
  ): Promise<Map<string, number>> {
    const params = new URLSearchParams({
      'search[tags]': tagName,
      'search[group]': group,
      'search[from]': from,
      'search[to]': defaultReportTo(),
    });
    const resp = await this.rateLimiter.fetch(
      `/reports/posts.json?${params.toString()}`,
      {headers: {Accept: 'application/json'}},
    );
    if (!resp.ok) throw new ReportStatusError(resp.status);
    return parseGroupReport(await resp.json(), group);
  }

  /**
   * Fetches post counts for each status (active, deleted, etc.).
   *
   * Deleted and active come from one `is_deleted` report (T-306): active is
   * Danbooru's own definition, not deleted, pending or flagged
   * (`Post.active`), and a post that is pending or flagged is never deleted
   * (deleting clears both) — so active = not deleted − pending − flagged.
   * Pending, flagged, appealed and banned stay counts. When the report
   * fails, deleted and active are counted as before.
   *
   * @param {string} tagName - The tag to analyze.
   * @return {Promise<Object>} - Map of status strings to counts.
   */
  async fetchStatusCounts(tagName: string): Promise<Record<string, number>> {
    const deletedGroups = this.fetchReportGroups(
      tagName,
      'is_deleted',
      MONTHLY_REPORT_FROM,
    ).catch((e: unknown) => {
      log.warn('Deleted report failed, counting statuses', {error: e});
      return null;
    });
    const counted = ['appealed', 'banned', 'flagged', 'pending'] as const;
    const [groups, ...counts] = await Promise.all([
      deletedGroups,
      ...counted.map(s => this.fetchCountWithRetry(`${tagName} status:${s}`)),
    ]);
    const [appealed, banned, flagged, pending] = counts;
    let deleted: number;
    let active: number;
    if (groups) {
      deleted = groups.get('true') ?? 0;
      active = Math.max(0, (groups.get('false') ?? 0) - pending - flagged);
    } else {
      // Only the two the report was for; the other four are in hand.
      [deleted, active] = await Promise.all([
        this.fetchCountWithRetry(`${tagName} status:deleted`),
        this.fetchCountWithRetry(`${tagName} status:active`),
      ]);
    }
    return {active, appealed, banned, deleted, flagged, pending};
  }

  /**
   * Fetches post counts for all ratings (g, s, q, e) for a tag, from one
   * `rating` report (T-306); counted one rating at a time if it fails.
   * @param {string} tagName The tag name.
   * @param {?string} startDate Optional start date (YYYY-MM-DD) to optimize query.
   * @return {Promise<!Object<string, number>>} Map of rating characters to counts.
   */
  async fetchRatingCounts(
    tagName: string,
    startDate: string | null = null,
  ): Promise<Record<string, number>> {
    try {
      const groups = await this.fetchReportGroups(
        tagName,
        'rating',
        startDate ?? MONTHLY_REPORT_FROM,
      );
      // A rating without posts has no row in the report.
      return Object.fromEntries(
        ['g', 's', 'q', 'e'].map(r => [r, groups.get(r) ?? 0]),
      );
    } catch (e) {
      log.warn('Rating report failed, counting each rating', {error: e});
    }
    return this.countRatings(tagName, startDate);
  }

  /** {@link fetchRatingCounts} with one count per rating (the fallback). */
  private async countRatings(
    tagName: string,
    startDate: string | null,
  ): Promise<Record<string, number>> {
    const ratings = ['g', 's', 'q', 'e'];
    const results: Record<string, number> = {};

    const tasks = ratings.map(async rating => {
      let tagQuery = `${tagName} rating:${rating}`;
      if (startDate) {
        tagQuery += ` date:>=${startDate}`;
      }
      results[rating] = await this.fetchCountWithRetry(tagQuery);
    });

    await Promise.all(tasks);

    // [Integrity Check] Ensure all keys exist and are valid numbers
    ratings.forEach(rating => {
      if (results[rating] === undefined) {
        log.warn(`Missing rating key: ${rating}. Defaulting to 0.`);
        results[rating] = 0;
      }
    });

    return results;
  }

  /**
   * The copyright or character distribution of a tag, approximated from
   * `/related_tag.json` frequencies (× the tag's post count). No counts are
   * sent here: the exact values are fetched by {@link fetchExactRelatedCounts}
   * only when the user opens that pie's tab (T-307).
   */
  async fetchRelatedTagDistribution(
    tagName: string,
    categoryId: number,
    totalTagCount: number,
  ): Promise<Record<string, number> | null> {
    const catName = categoryId === 3 ? 'Copyright' : 'Character';

    // 1. Fetch Related Tags
    const relatedUrl = `/related_tag.json?commit=Search&search[category]=${categoryId}&search[order]=Frequency&search[query]=${encodeURIComponent(tagName)}`;

    try {
      const resp: DanbooruRelatedTagResponse = await this.rateLimiter
        .fetch(relatedUrl)
        .then((r: Response) => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags))
        return null;

      const tags: DanbooruRelatedTag[] = resp.related_tags;

      // Limit to top 20 candidates for performance
      const candidates: DanbooruRelatedTag[] = tags.slice(0, 20);

      // 2. Filter Top-Level via a SINGLE batched implications lookup
      //    (previously 20 serial-rate-limited calls). Session + 180d
      //    persistent cache make this ~free after warmup.
      const flags = await this.getTopLevelFlags(
        candidates.map(c => c.tag.name),
      );
      const filtered = candidates.filter(
        item => flags.get(item.tag.name) === true,
      );

      // 3. Build approximate distribution from frequency × totalCount.
      //    No per-combination /counts/posts.json queries here.
      return distributionToCountMap(
        buildDistributionApprox(filtered, totalTagCount),
      );
    } catch (e) {
      log.warn(`Failed to fetch ${catName} distribution`, {error: e});
      return null;
    }
  }

  /**
   * Exact counts for a related-tag pie, one `/counts/posts.json` per slice
   * (`<tag> <related tag>`, up to 10). Run when the pie's tab is opened,
   * not with every analysis (T-307). A slice whose count fails keeps its
   * approximation and makes the result incomplete, so the caller can try
   * again later. The "others" slice is an estimate by nature and passes
   * through.
   */
  async fetchExactRelatedCounts(
    tagName: string,
    approx: Record<string, number>,
  ): Promise<{counts: Record<string, number>; complete: boolean}> {
    const counts: Record<string, number> = {...approx};
    let complete = true;
    await Promise.all(
      Object.keys(approx)
        .filter(key => key !== 'others')
        .map(async key => {
          try {
            counts[key] = await fetchRemoteCount(
              this.rateLimiter,
              `${tagName} ${key}`,
            );
          } catch (e) {
            complete = false;
            log.debug('Exact related count failed, keeping approx', {
              tag: key,
              error: e,
            });
          }
        }),
    );
    return {counts, complete};
  }

  /**
   * Merges `patch` into this tag's cached report without touching its age,
   * so a later refinement (exact related counts, T-307) outlives the page.
   * Nothing is written when there is no current (UTC-history) report: a
   * run that was not saved, e.g. a partial history, stays unsaved.
   */
  async patchCachedReport(patch: Partial<TagAnalyticsMeta>): Promise<void> {
    if (!this.db?.tag_analytics) return;
    try {
      const record = await this.db.tag_analytics.get(this.tagName);
      if (!record || !hasUtcHistory(record.data)) return;
      await this.db.tag_analytics.put({
        ...record,
        data: {...record.data, ...patch},
      });
    } catch (e) {
      log.warn('Cache patch failed', {error: e});
    }
  }

  async fetchMilestonesDelta(
    tagName: string,
    currentTotal: number,
    cachedMilestones: MilestoneEntry[],
    fullHistory: HistoryEntry[],
  ): Promise<MilestoneEntry[]> {
    const allTargets = this.getMilestoneTargets(currentTotal);
    const existingTargets = new Set(cachedMilestones.map(m => m.milestone));
    const missingTargets = allTargets.filter(t => !existingTargets.has(t));

    if (missingTargets.length === 0) return [];

    return this.fetchMilestones(tagName, fullHistory, missingTargets);
  }

  mergeMilestones<T extends {milestone: number}>(
    oldMilestones: T[],
    newMilestones: T[] | null,
  ): T[] {
    if (!newMilestones || newMilestones.length === 0) return oldMilestones;
    // Sort by milestone number
    return [...oldMilestones, ...newMilestones].sort(
      (a, b) => a.milestone - b.milestone,
    );
  }

  async fetchLatestPost(tagName: string): Promise<DanbooruPost | null> {
    // Query for the single latest post
    const url = `/posts.json?tags=${encodeURIComponent(tagName)}&limit=1&only=id,created_at,variants,uploader_id,rating,preview_file_url`;
    try {
      const posts = await this.rateLimiter
        .fetch(url)
        .then((r: Response) => r.json());
      return posts && posts.length > 0 ? posts[0] : null;
    } catch (e) {
      log.warn('Failed to fetch latest post', {error: e});
      return null;
    }
  }

  async fetchNewPostCount(tagName: string): Promise<number> {
    try {
      return await fetchRemoteCount(this.rateLimiter, `${tagName} age:..1d`);
    } catch (e) {
      log.warn('Failed to fetch new post count', {error: e});
      return 0;
    }
  }

  async fetchTrendingPost(
    tagName: string,
    isNSFW: boolean = false,
  ): Promise<DanbooruPost | null> {
    // Query for the most popular SFW (or NSFW) post in the last 3 days
    // age:..3d, order:score, rating:g (or is:nsfw)
    const ratingQuery = isNSFW ? 'is:nsfw' : 'is:sfw';
    const url = `/posts.json?tags=${encodeURIComponent(tagName)}+age:..3d+order:score+${ratingQuery}&limit=1&only=id,created_at,variants,uploader_id,rating,score,preview_file_url`;
    try {
      const posts = await this.rateLimiter
        .fetch(url)
        .then((r: Response) => r.json());
      return posts && posts.length > 0 ? posts[0] : null;
    } catch (e) {
      log.warn('Failed to fetch trending post', {error: e});
      return null;
    }
  }

  // --- Helper Methods for Rankings ---

  calculateLocalStats(
    posts: Array<Pick<DanbooruPost, 'rating' | 'uploader_id' | 'approver_id'>>,
  ): LocalStats {
    const ratingCounts: Record<string, number> = {g: 0, s: 0, q: 0, e: 0};
    const uploaders: Record<string, number> = {};
    const approvers: Record<string, number> = {};

    posts.forEach(p => {
      // Rating
      if (ratingCounts[p.rating] !== undefined) ratingCounts[p.rating]++;

      // Uploader
      if (p.uploader_id) {
        uploaders[p.uploader_id] = (uploaders[p.uploader_id] || 0) + 1;
      }

      // Approver
      if (p.approver_id) {
        approvers[p.approver_id] = (approvers[p.approver_id] || 0) + 1;
      }
    });

    // Sort Rankings
    const sortMap = (map: Record<string, number>) =>
      Object.entries(map)
        .sort((a, b) => (b[1] as number) - (a[1] as number)) // Descending count
        .slice(0, 100) // Top 100
        .map(([id, count], index) => ({id, count, rank: index + 1}));

    return {
      ratingCounts,
      uploaderRanking: sortMap(uploaders),
      approverRanking: sortMap(approvers),
    };
  }

  /**
   * Top 10 uploaders or approvers of `tagName` between two dates, from
   * `/reports/posts.json` (`search[group]`, `search[group_limit]=10`;
   * `from` / `to` are `YYYY-MM-DD`, both included). The reply is a JSON
   * array of rows, one per user.
   *
   * Throws on a failed request, an HTTP error or a reply that is not an
   * array. It used to read the error body as the ranking and come back
   * empty, which then replaced the cached ranking (N-04).
   */
  async fetchReportRanking(
    tagName: string,
    group: 'uploader' | 'approver',
    from: string,
    to: string,
  ): Promise<ReportEntry[]> {
    const params = new URLSearchParams({
      'search[tags]': tagName,
      'search[group]': group,
      'search[mode]': 'table',
      'search[group_limit]': '10',
      commit: 'Search',
    });

    if (from) params.append('search[from]', from);
    if (to) params.append('search[to]', to);

    const url = `/reports/posts.json?${params.toString()}`;
    const resp = await this.rateLimiter.fetch(url, {
      headers: {Accept: 'application/json'},
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: unknown = await resp.json();
    if (!Array.isArray(data)) throw new Error('Report reply is not a list');
    return data as ReportEntry[];
  }

  // -----------------------------------

  /**
   * The tag's monthly history (UTC months) from Danbooru's reports, in up
   * to three layers (PLAN.md 4.2, T-302):
   *
   * 1. One report for the whole range, 2005 to today. Most tags end here,
   *    with no monthly count cache involved.
   * 2. A report the server could not finish in time (5xx) is asked for
   *    again in halves, down to {@link REPORT_HISTORY_MIN_SPLIT_MONTHS}
   *    months and {@link REPORT_HISTORY_MAX_REQUESTS} requests in all. The
   *    finished months are then cached (`tag_monthly_counts`), and the
   *    next run starts after the cached months it can still trust
   *    (`isMonthlyCountValid`), so a heavy tag only asks for its recent
   *    part.
   * 3. When the reports cannot give the history (still timing out, an
   *    error reply, an unreadable body), one count per month from
   *    `startDate`, through {@link fetchMonthlyCounts}. A lost month there
   *    makes the result `partial`.
   *
   * @param opts `startDate` (the tag's first post) bounds layer 3;
   *     `totalCount` feeds its drift guard.
   */
  async fetchMonthlyHistory(
    tagName: string,
    opts: {startDate?: Date | string; totalCount?: number} = {},
  ): Promise<MonthlyHistory> {
    const now = new Date();
    const cached = await this.readCachedMonthPrefix(now);
    const state = {requests: 0, split: false, failed: false};
    try {
      const fetched = await this.fetchReportRange(
        tagName,
        cached.nextFrom,
        defaultReportTo(now),
        state,
      );
      if (state.split) await this.cacheClosedMonths(fetched, now);
      return {
        history: trimMonthlyCounts(
          mergeMonthlyCounts([cached.counts, fetched]),
          now,
        ),
        layer: state.split || cached.counts.size > 0 ? 2 : 1,
        partial: false,
      };
    } catch (e) {
      log.warn('Monthly report failed, counting month by month', {
        tag: tagName,
        requests: state.requests,
        error: e,
      });
    }

    const counted = await this.fetchMonthlyCounts(
      tagName,
      opts.startDate ?? MONTHLY_REPORT_FROM,
      {isFullScan: true, totalCount: opts.totalCount},
    );
    return {history: [...counted], layer: 3, partial: !!counted.partial};
  }

  /**
   * The monthly report for `[from, to]`, halved and asked again while the
   * server times out (layer 2). Throws when a piece cannot be split any
   * further, the request budget is spent, or the reply is not a timeout;
   * the other pieces then send nothing more (`failed`).
   */
  private async fetchReportRange(
    tagName: string,
    from: string,
    to: string,
    state: {requests: number; split: boolean; failed: boolean},
  ): Promise<MonthlyCounts> {
    if (state.failed) throw new Error('Monthly report already failed');
    state.requests++;
    try {
      return await this.fetchMonthlyReport(tagName, from, to);
    } catch (e) {
      const mid = isReportTimeout(e)
        ? splitReportRange(from, to, REPORT_HISTORY_MIN_SPLIT_MONTHS)
        : null;
      if (
        state.failed ||
        !mid ||
        state.requests + 2 > REPORT_HISTORY_MAX_REQUESTS
      ) {
        state.failed = true;
        throw e;
      }
      state.split = true;
      log.debug('Monthly report timed out, splitting', {from, mid, to});
      const halves = await Promise.all([
        this.fetchReportRange(tagName, from, mid, state),
        this.fetchReportRange(tagName, mid, to, state),
      ]);
      return mergeMonthlyCounts(halves);
    }
  }

  /**
   * One monthly report. A 429 is asked again once: the reports lane of the
   * shared limiter holds the retry until Danbooru's bucket allows it.
   */
  private async fetchMonthlyReport(
    tagName: string,
    from: string,
    to: string,
  ): Promise<MonthlyCounts> {
    const url = buildMonthlyReportUrl(tagName, {from, to});
    const init = {headers: {Accept: 'application/json'}};
    let resp = await this.rateLimiter.fetch(url, init);
    if (resp.status === 429) resp = await this.rateLimiter.fetch(url, init);
    if (!resp.ok) throw new ReportStatusError(resp.status);
    return parseMonthlyReport(await resp.json());
  }

  /**
   * The cached months this tag's history can start from: the longest run
   * from {@link MONTHLY_REPORT_FROM} with every month still valid, and the
   * date to ask the report from after it. Only a layer-2 run writes such a
   * run (it caches from 2005 on); otherwise the cache gives nothing here
   * and the report starts in 2005.
   */
  private async readCachedMonthPrefix(
    now: Date,
  ): Promise<{counts: MonthlyCounts; nextFrom: string}> {
    const months = monthKeysBetween(MONTHLY_REPORT_FROM, utcDateString(now));
    const records = await this.readMonthlyCountsCache(months);
    const counts: MonthlyCounts = new Map();
    for (const month of months) {
      const r = records.get(month);
      if (!r || !isMonthlyCountValid(month, r.fetchedAt, now.getTime())) {
        return {counts, nextFrom: `${month}-01`};
      }
      counts.set(month, r.count);
    }
    // Unreachable in practice: the current month is never valid.
    return {counts, nextFrom: utcDateString(now)};
  }

  /**
   * Caches the months of a split report that will not change any more
   * (two or more months back), leading empty months included, so the next
   * run can start after them.
   */
  private async cacheClosedMonths(
    counts: MonthlyCounts,
    now: Date,
  ): Promise<void> {
    const closed = [...counts]
      .filter(([month]) => computeMonthsDistance(month, now) >= 2)
      .map(([yearMonth, count]) => ({yearMonth, count}));
    await this.writeMonthlyCountsCache(closed);
  }

  /**
   * Fetches monthly post counts for the tag since the start date, one
   * count per UTC month. Layer 3 of {@link fetchMonthlyHistory}; months
   * whose count is lost read as 0 and mark the result `partial`.
   *
   * Cache-aware path: when the `tag_monthly_counts` table has entries for
   * months outside the Delta sync window (current + previous month), those
   * counts are reused subject to distance-based TTL. Freshly fetched months
   * are written back to the cache. On a full-range call, a 2% drift guard
   * compares cached sum to `opts.totalCount`; a 90-day forced rescan bypasses
   * cache entirely to recover from slow erosion the drift guard misses.
   *
   * @param tagName The tag name.
   * @param startDate The date to start fetching from.
   * @param opts Optional caching hints. `isFullScan` should be true only when
   *   the call covers the full historical range (enables forced-rescan and
   *   drift guard). `totalCount` enables the drift guard. `skipCache` forces
   *   a fresh network fetch for every month.
   */
  // T-26 baseline: complexity 31. Per-month distance-based TTL × cache hit
  // class × drift guard × fetch retry, all interleaved.
  // eslint-disable-next-line complexity
  async fetchMonthlyCounts(
    tagName: string,
    startDate: Date | string,
    opts: {
      totalCount?: number;
      isFullScan?: boolean;
      skipCache?: boolean;
    } = {},
  ): Promise<MonthlyCountsData> {
    const startDateObj =
      startDate instanceof Date ? startDate : new Date(startDate);

    // UTC months, like the reports (layers 1-2) and the small-tag path.
    // Local getters started a month early west of UTC.
    const startYear = startDateObj.getUTCFullYear();
    const startMonth = startDateObj.getUTCMonth(); // 0-based

    const now = new Date();
    const nowMs = now.getTime();

    // Iterate Month by Month
    // Example full range: 2005 to 2026 = 21 years * 12 = 252 requests @ 6rps ≈ 42s.
    // The cache layer below lets revisits reuse most of that work.
    type Task = {dateStr: string; yearMonth: string; queryDate: string};
    const tasks: Task[] = [];
    // Use UTC to avoid timezone shifts in labels (April appearing as March)
    const current = new Date(Date.UTC(startYear, startMonth, 1));

    while (current <= now) {
      const y = current.getUTCFullYear();
      const m = current.getUTCMonth() + 1; // 1-based for API
      const dateStr = `${y}-${String(m).padStart(2, '0')}-01`;
      const yearMonth = `${y}-${String(m).padStart(2, '0')}`;

      // Next Month for Range
      const nextMonth = new Date(current);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const nextY = nextMonth.getUTCFullYear();
      const nextM = nextMonth.getUTCMonth() + 1;

      // Danbooru counts API needs the date filter INSIDE the tags parameter.
      // Explicit UTC instants: a bare date is read in the viewer's time zone
      // (`Time.zone.parse`), which shifted every month by its offset.
      // `a...b` excludes `b`.
      let rangeEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00Z`;

      // [OPTIMIZATION] Cap range at NOW when the month is the current one to
      // avoid race conditions with posts added during the fetch.
      if (nextMonth > now) {
        rangeEnd = now.toISOString();
      }

      const queryDate = `${y}-${String(m).padStart(2, '0')}-01T00:00:00Z...${rangeEnd}`;

      tasks.push({dateStr, yearMonth, queryDate});

      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    // -------------------------------------------------------------------
    // Cache layer
    // -------------------------------------------------------------------
    const cacheEnabled =
      !opts.skipCache && this.db?.tag_monthly_counts !== undefined;

    // 90-day forced rescan — only meaningful on a full-range call. First
    // visits (lastScan === 0) also take this path so we always mark the
    // scan timestamp after a successful first fetch.
    let forcedFullScan = false;
    if (cacheEnabled && opts.isFullScan) {
      const lastScan = await this.getLastFullScanAt();
      if (lastScan === 0 || nowMs - lastScan > MONTHLY_CACHE_FULL_RESCAN_MS) {
        forcedFullScan = true;
        log.debug('Monthly cache: forced full rescan', {
          tag: tagName,
          lastScan,
          ageDays:
            lastScan === 0
              ? null
              : Math.round((nowMs - lastScan) / CACHE_DAY_MS),
        });
      }
    }

    // Read cache (unless forced-rescan / cache disabled)
    let cached = new Map<string, MonthlyCountRecord>();
    if (cacheEnabled && !forcedFullScan) {
      cached = await this.readMonthlyCountsCache(tasks.map(t => t.yearMonth));

      // Drift guard — only runs on full-range call with near-complete cache.
      // Compares cached sum to remote totalCount; > 2% drift invalidates.
      if (
        opts.isFullScan &&
        opts.totalCount !== undefined &&
        opts.totalCount > 0 &&
        tasks.length > 0 &&
        cached.size / tasks.length > 0.95
      ) {
        let cachedSum = 0;
        cached.forEach(r => {
          cachedSum += r.count;
        });
        const drift = Math.abs(cachedSum - opts.totalCount) / opts.totalCount;
        if (drift > MONTHLY_CACHE_DRIFT_THRESHOLD) {
          log.warn('Monthly cache drift detected, invalidating', {
            tag: tagName,
            cachedSum,
            totalCount: opts.totalCount,
            drift,
          });
          await this.invalidateMonthlyCountsCache();
          cached = new Map();
          forcedFullScan = true;
        }
      }
    }

    // Split tasks into cache-hit and needs-fetch
    const cachedResults: HistoryEntry[] = [];
    const fetchTasks: Task[] = [];
    for (const task of tasks) {
      const entry = forcedFullScan ? undefined : cached.get(task.yearMonth);
      if (
        entry &&
        isMonthlyCountValid(task.yearMonth, entry.fetchedAt, nowMs)
      ) {
        cachedResults.push({
          date: task.dateStr,
          count: entry.count,
          cumulative: 0,
        });
      } else {
        fetchTasks.push(task);
      }
    }

    // -------------------------------------------------------------------
    // Network fetch for missing/expired months
    // -------------------------------------------------------------------
    const fetchedResults = await Promise.all(
      fetchTasks.map(task =>
        fetchRemoteCount(
          this.rateLimiter,
          `${tagName} status:any date:${task.queryDate}`,
        )
          .then(count => ({
            date: task.dateStr,
            yearMonth: task.yearMonth,
            count,
            ok: true as const,
          }))
          .catch((e: unknown) => {
            log.warn(`Failed month ${task.dateStr}`, {error: e});
            return {
              date: task.dateStr,
              yearMonth: task.yearMonth,
              count: 0,
              ok: false as const,
            };
          }),
      ),
    );

    // -------------------------------------------------------------------
    // Write fetched results back to cache (only successful fetches)
    // -------------------------------------------------------------------
    if (cacheEnabled) {
      const toWrite = fetchedResults
        .filter(r => r.ok)
        .map(r => ({yearMonth: r.yearMonth, count: r.count}));
      if (toWrite.length > 0) {
        await this.writeMonthlyCountsCache(toWrite);
      }
    }

    // -------------------------------------------------------------------
    // Persist last-full-scan marker when this was a forced full scan AND
    // every task actually went to the network successfully. Partial failures
    // mean we can't vouch for the cache's completeness, so we skip the mark.
    // -------------------------------------------------------------------
    if (
      cacheEnabled &&
      forcedFullScan &&
      fetchTasks.length === tasks.length &&
      fetchedResults.every(r => r.ok)
    ) {
      await this.persistFullScanMarker(nowMs);
    }

    // -------------------------------------------------------------------
    // Combine cached + fetched, sort chronologically, compute cumulative
    // -------------------------------------------------------------------
    const combined: HistoryEntry[] = [
      ...cachedResults,
      ...fetchedResults.map(r => ({
        date: r.date,
        count: r.count,
        cumulative: 0,
      })),
    ];
    combined.sort((a, b) => a.date.localeCompare(b.date));

    let cumulative = 0;
    for (const item of combined) {
      cumulative += item.count;
      item.cumulative = cumulative;
    }

    const monthlyData: MonthlyCountsData = combined;
    // A lost month reads as 0 above; the caller must not cache this history.
    if (fetchedResults.some(r => !r.ok)) monthlyData.partial = true;
    return monthlyData;
  }

  /**
   * Reads the last full-scan timestamp from the tag_analytics record.
   * Returns 0 if the record does not exist or the field is absent.
   */
  private async getLastFullScanAt(): Promise<number> {
    if (!this.db?.tag_analytics) return 0;
    try {
      const record = await this.db.tag_analytics.get(this.tagName);
      return record?.lastFullScanAt ?? 0;
    } catch (e) {
      log.warn('Failed to read lastFullScanAt', {error: e});
      return 0;
    }
  }

  /**
   * Finds the milestone posts (the 1st, 100th, 1000th, … post of the tag)
   * from the monthly history: each target's month from the running total,
   * then the post at its place in that month ({@link milestoneLookup}).
   * Three lookups at a time; the shared rate limiter paces them.
   *
   * @param tagName The tag name.
   * @param monthlyData The history, oldest month first (UTC months).
   * @param targets The milestone targets (e.g., [1, 100, 1000]).
   * @return The milestones found; a target whose post could not be fetched
   *     is left out.
   */
  async fetchMilestones(
    tagName: string,
    monthlyData: HistoryEntry[],
    targets: number[],
  ): Promise<MilestoneEntry[]> {
    if (!monthlyData || monthlyData.length === 0) return [];

    const lookups = [...targets]
      .sort((a, b) => a - b)
      .map(target => milestoneLookup(tagName, monthlyData, target))
      .filter((l): l is MilestoneLookup => l !== null);

    const found: Array<MilestoneEntry | null> = new Array(lookups.length);
    let next = 0;
    const worker = async () => {
      while (next < lookups.length) {
        const i = next++;
        found[i] = await this.fetchMilestonePost(lookups[i]);
      }
    };
    await Promise.all(
      Array.from(
        {length: Math.min(MILESTONE_CONCURRENCY, lookups.length)},
        worker,
      ),
    );
    const milestones = found.filter((m): m is MilestoneEntry => m !== null);

    // Batch Fetch Uploaders for Milestones
    await this.backfillUploaderNames(milestones);

    return milestones;
  }

  /** One milestone post, or null when it could not be fetched. */
  private async fetchMilestonePost(
    lookup: MilestoneLookup,
  ): Promise<MilestoneEntry | null> {
    const params = new URLSearchParams({
      tags: lookup.query,
      limit: String(lookup.limit),
      page: String(lookup.page),
      only: 'id,created_at,uploader_id,uploader_name,variants,rating,preview_file_url',
    });
    try {
      const resp = await this.rateLimiter.fetch(
        `/posts.json?${params.toString()}`,
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const posts: unknown = await resp.json();
      const post = Array.isArray(posts)
        ? (posts[lookup.index] as DanbooruPost | undefined)
        : undefined;
      if (!post) {
        log.warn(`Milestone ${lookup.milestone} post not found`, {
          index: lookup.index,
          page: lookup.page,
          postsLen: Array.isArray(posts) ? posts.length : 0,
        });
        return null;
      }
      return {milestone: lookup.milestone, post} as MilestoneEntry;
    } catch (e) {
      log.warn(`Failed milestone ${lookup.milestone}`, {error: e});
      return null;
    }
  }

  /**
   * Backfills uploader and approver names for a list of items (posts or milestones).
   * @param {!Array<Object>} items The items to process.
   * @return {Promise<!Array<Object>>} The items with names attached.
   */
  async backfillUploaderNames(
    items: Array<DanbooruPost | MilestoneEntry>,
  ): Promise<Array<DanbooruPost | MilestoneEntry>> {
    const userIds = new Set<number | string>();
    items.forEach(item => {
      const p = ('post' in item ? item.post : item) as DanbooruPost; // Handle both raw post and { milestone, post } wrapper
      if (p.uploader_id) userIds.add(p.uploader_id);
      if (p.approver_id) userIds.add(p.approver_id);
    });

    if (userIds.size > 0) {
      const userMap = await this.fetchUserMap(
        Array.from(userIds) as (string | number)[],
      );

      // Store in instance map for rankings
      userMap.forEach((uObj, id) => {
        this.userNames[id] = uObj;
      });

      // Backfill names & levels
      items.forEach(item => {
        const p = ('post' in item ? item.post : item) as DanbooruPost;
        const uId = String(p.uploader_id);
        if (p.uploader_id && userMap.has(uId)) {
          const u = userMap.get(uId)!;
          p.uploader_name = u.name;
          p.uploader_level = u.level;
        }
        const aId = String(p.approver_id);
        if (p.approver_id && userMap.has(aId)) {
          const a = userMap.get(aId)!;
          p.approver_name = a.name;
          p.approver_level = a.level;
        }
      });
    }
    return items;
  }

  /**
   * Fetches a map of user IDs to user objects (name, level).
   * Batches requests to avoid rate limits.
   * @param {!Array<string|number>} userIds List of user IDs.
   * @return {Promise<!Map<string, {name: string, level: string}>>} Map of ID to user info.
   */
  async fetchUserMap(
    userIds: (string | number)[],
  ): Promise<Map<string, UserEntry>> {
    const userMap = new Map<string, UserEntry>();
    if (!userIds || userIds.length === 0) return userMap;

    const uniqueIds = Array.from(new Set(userIds));
    const batchSize = 20;
    const userBatches = [];

    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      userBatches.push(uniqueIds.slice(i, i + batchSize));
    }

    const userPromises = userBatches.map(batch => {
      const params = new URLSearchParams({
        'search[id]': batch.join(','),
        only: 'id,name,level_string',
      });
      const url = `/users.json?${params.toString()}`;
      return this.rateLimiter
        .fetch(url)
        .then((r: Response) => r.json())
        .then((users: DanbooruUser[]) => {
          if (Array.isArray(users)) {
            users.forEach((u: DanbooruUser) =>
              userMap.set(String(u.id), {name: u.name, level: u.level_string}),
            );
          }
        })
        .catch((e: unknown) =>
          log.warn('Failed to fetch user batch', {error: e}),
        );
    });

    await Promise.all(userPromises);
    return userMap;
  }

  /**
   * Fetches a map of user names to user objects.
   * Fetches individually as batching by name is not reliably supported.
   * @param {!Array<string>} userNames List of user names.
   * @return {Promise<!Map<string, {id: number, name: string, level: string}>>} Map of name to user info.
   */
  async fetchUserMapByNames(
    userNames: string[],
  ): Promise<Map<string, UserEntryWithId>> {
    const userMap = new Map<string, UserEntryWithId>(); // Key: Name, Value: { id, name, level }
    if (!userNames || userNames.length === 0) return userMap;

    const uniqueNames = Array.from(new Set(userNames));
    // Batch fetching by name is unreliable (no clear support for comma-separated list in search[name])
    // Fetch individually for robustness.
    // RateLimiter handles concurrency.

    const userPromises = uniqueNames.map(name => {
      const params = new URLSearchParams({
        'search[name]': name, // Exact match usually
        only: 'id,name,level_string',
      });
      const url = `/users.json?${params.toString()}`;

      return this.rateLimiter
        .fetch(url)
        .then((r: Response) => r.json())
        .then((users: DanbooruUser[]) => {
          if (Array.isArray(users) && users.length > 0) {
            // Should return 1 user if exact match
            const u = users[0];
            if (u) {
              userMap.set(name, {
                id: u.id,
                name: u.name,
                level: u.level_string,
              });
              // Also map by returned name just in case case sensitivity differs
              userMap.set(u.name, {
                id: u.id,
                name: u.name,
                level: u.level_string,
              });
            }
          } else {
            log.warn(`User not found by name: "${name}"`);
          }
        })
        .catch((e: unknown) =>
          log.warn(`Failed to fetch user: "${name}"`, {error: e}),
        );
    });

    await Promise.all(userPromises);
    return userMap;
  }

  /**
   * Resolves uploader/approver names for the first 100 stats structure.
   * @param {!Object} stats The stats object containing rankings.
   * @return {Promise<!Object>} The updated stats object.
   */
  async resolveFirst100Names(stats: LocalStats): Promise<LocalStats> {
    const ids = new Set<string>();
    if (stats.uploaderRanking)
      stats.uploaderRanking.forEach((u: UserRanking) => ids.add(String(u.id)));
    if (stats.approverRanking)
      stats.approverRanking.forEach((u: UserRanking) => ids.add(String(u.id)));

    const userMap = await this.fetchUserMap(Array.from(ids));

    if (stats.uploaderRanking) {
      stats.uploaderRanking.forEach((u: UserRanking) => {
        const uid = String(u.id);
        if (userMap.has(uid)) {
          const uObj = userMap.get(uid)!;
          u.name = uObj.name;
          u.level = uObj.level;
        }
      });
    }
    if (stats.approverRanking) {
      stats.approverRanking.forEach((u: UserRanking) => {
        const uid = String(u.id);
        if (userMap.has(uid)) {
          const uObj = userMap.get(uid)!;
          u.name = uObj.name;
          u.level = uObj.level;
        }
      });
    }
    return stats;
  }

  /**
   * Calculates history data locally from an array of posts.
   * Useful for small tags where we have all posts.
   * @param {!Array<Object>} posts The list of posts.
   * @return {!Array<{date: string, count: number, cumulative: number}>} Calculated history.
   */
  calculateHistoryFromPosts(
    posts: Array<Pick<DanbooruPost, 'created_at'>> | null,
  ): HistoryEntry[] {
    if (!posts || posts.length === 0) return [];

    // Sort by date asc
    const sorted = [...posts].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const counts: Record<string, number> = {}; // "YYYY-MM" -> count

    sorted.forEach(p => {
      const d = new Date(p.created_at);
      if (isNaN(d.getTime())) return;
      // Use UTC components to match fetchMonthlyCounts labels
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    const startDate = new Date(sorted[0].created_at);
    const now = new Date();
    const history = [];
    let cumulative = 0;

    // Start from the month of the first post (using UTC to prevent timezone shifts)
    const current = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1),
    );

    while (current <= now) {
      const key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`;
      const count = counts[key] || 0;
      cumulative += count;

      const dateStr = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`;

      history.push({
        date: dateStr, // Store as string for consistency with fetchMonthlyCounts
        count: count,
        cumulative: cumulative,
      });

      current.setUTCMonth(current.getUTCMonth() + 1);
    }
    return history;
  }

  /**
   * Generates a list of target numbers for milestones (e.g., 1, 100, 1000).
   * @param {number} total The total number of posts.
   * @return {!Array<number>} Sorted list of milestone targets.
   */
  getMilestoneTargets(total: number): number[] {
    const milestones = new Set([1]);
    if (total >= 100) milestones.add(100);
    if (total >= 1000) milestones.add(1000);
    if (total >= 10000) milestones.add(10000);
    if (total >= 100000) milestones.add(100000);
    if (total >= 1000000) milestones.add(1000000);

    const step = this.getMilestoneStep(total);

    for (let i = step; i <= total; i += step) {
      milestones.add(i);
    }

    const res = Array.from(milestones).sort((a, b) => a - b);

    return res;
  }

  /**
   * Returns the milestone step interval used for a given total. Mirrors the
   * thresholds in `getMilestoneTargets`. Pure helper, kept separate so the
   * "next milestone" placeholder card can compute the upcoming target without
   * regenerating the whole sequence.
   */
  getMilestoneStep(total: number): number {
    if (total < 2500) return 100;
    if (total < 5000) return 250;
    if (total < 10000) return 500;
    if (total < 25000) return 1000;
    if (total < 50000) return 2500;
    if (total < 100000) return 5000;
    if (total < 250000) return 10000;
    if (total < 500000) return 25000;
    if (total < 1000000) return 50000;
    if (total < 2500000) return 100000;
    if (total < 5000000) return 250000;
    return 500000;
  }

  /**
   * Computes the next (un-reached) milestone target above `total`. Returns
   * a value strictly greater than `total`, picked from the union of base
   * milestones (1, 100, 1000, ...) and the step sequence.
   */
  getNextMilestoneTarget(total: number): number {
    if (total < 1) return 1;
    if (total < 100) return 100;
    if (total < 1000) {
      // Step is 100 in this range; next multiple of 100 above total
      return Math.floor(total / 100) * 100 + 100;
    }
    const step = this.getMilestoneStep(total);
    const nextStep = Math.floor(total / step) * step + step;

    // Also consider the next "round base" milestone (10k / 100k / 1M) so we
    // don't skip past a notable number just because it isn't a step boundary.
    const bases = [10000, 100000, 1000000, 10000000];
    let next = nextStep;
    for (const b of bases) {
      if (b > total && b < next) next = b;
    }
    return next;
  }

  async fetchRankingsAndResolve(
    tagName: string,
    dateStr1Y: string,
    dateStrTomorrow: string,
    measure: <T>(label: string, promise: Promise<T>) => Promise<T>,
  ): Promise<RankingResult> {
    // 1. Fetch all rankings in parallel (the reports lane paces them). A
    // failed report is listed in `failed`, never passed off as empty.
    const failed: RankingSlot[] = [];
    const report = (
      slot: RankingSlot,
      label: string,
      group: 'uploader' | 'approver',
      from: string,
    ): Promise<ReportEntry[]> =>
      measure(
        label,
        this.fetchReportRanking(tagName, group, from, dateStrTomorrow),
      ).catch((e: unknown) => {
        log.warn(`Ranking fetch failed (${slot})`, {error: e});
        failed.push(slot);
        return [];
      });
    const [uAll, aAll, uYear, aYear] = await Promise.all([
      report('uploaderAll', 'Ranking (Uploader All)', 'uploader', '2005-01-01'),
      report('approverAll', 'Ranking (Approver All)', 'approver', '2005-01-01'),
      report('uploaderYear', 'Ranking (Uploader Year)', 'uploader', dateStr1Y),
      report('approverYear', 'Ranking (Approver Year)', 'approver', dateStr1Y),
    ]);

    // 2. Resolve Users Immediately
    // --- Collect All User IDs & Names for Batch Backfill ---
    const uRankingIds = new Set<string>();
    const uRankingNames = new Set<string>();
    const getKey = (r: ReportEntry) =>
      r.name || r.uploader || r.approver || r.user;
    const normalize = (n: string) => (n ? n.replace(/ /g, '_') : '');

    [uAll, uYear, aAll, aYear].forEach(report => {
      if (Array.isArray(report))
        report.forEach(r => {
          if (r.id) uRankingIds.add(String(r.id));
          else {
            const n = normalize(getKey(r) ?? '');
            if (n && n !== 'Unknown') uRankingNames.add(n);
          }
        });
    });

    // Fetch User Metadata (ID)
    if (uRankingIds.size > 0) {
      const userMap = await this.fetchUserMap(Array.from(uRankingIds));
      userMap.forEach((uObj, id) => {
        this.userNames[id] = uObj;
      });
    }

    // Fetch User Metadata (Name)
    if (uRankingNames.size > 0) {
      const nameMap = await this.fetchUserMapByNames(Array.from(uRankingNames));
      nameMap.forEach((uObj, name) => {
        this.userNames[name] = uObj; // Map Name -> Object
        if (uObj.id) this.userNames[String(uObj.id)] = uObj; // Map ID -> Object
      });
    }

    // Process Report Data to Rankings
    const processReport = (report: ReportEntry[]): UserRanking[] => {
      if (Array.isArray(report)) {
        return report.map((r: ReportEntry) => {
          const rawKey = getKey(r) || 'Unknown';
          const nName = normalize(rawKey);
          // Lookup by ID first, then by Name
          const u =
            (r.id ? this.userNames[String(r.id)] : null) ||
            this.userNames[nName];

          const level = u ? u.level : null;
          const finalName = u ? u.name : rawKey;
          const count = r.posts || r.count || r.post_count || 0;
          return {id: r.id ?? u?.id ?? 0, name: finalName, level, count};
        });
      }
      return [];
    };

    const result: RankingResult = {
      uploaderAll: processReport(uAll),
      approverAll: processReport(aAll),
      uploaderYear: processReport(uYear),
      approverYear: processReport(aYear),
    };
    if (failed.length > 0) {
      result.failed = RANKING_SLOTS.filter(s => failed.includes(s));
    }
    return result;
  }

  async fetchTagData(tagName: string): Promise<DanbooruTag | null> {
    const cached = this._tagDataMemo.get(tagName);
    if (cached && Date.now() - cached.ts < this._tagDataTTL) {
      return cached.value;
    }
    try {
      // use name_matches to find the exact tag
      const url = `/tags.json?search[name_matches]=${encodeURIComponent(tagName)}`;
      const resp = await this.rateLimiter
        .fetch(url)
        .then((r: Response) => r.json());

      let result: DanbooruTag | null = null;
      if (Array.isArray(resp) && resp.length > 0) {
        // Find exact match to be safe
        const exact = resp.find(t => t.name === tagName);
        result = exact || resp[0];
      }
      this._tagDataMemo.set(tagName, {value: result, ts: Date.now()});
      return result;
    } catch (e) {
      log.error('Tag fetch error', {error: e});
      return null;
    }
  }

  /**
   * Extracts the tag name from the current URL.
   * Supports Wiki pages and Artist pages.
   * @return {?string} The tag name or null if not found.
   */
  getTagNameFromUrl() {
    const path = window.location.pathname;
    // Format: /wiki_pages/TAG_NAME
    const match = path.match(/\/wiki_pages\/([^/]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }
}
