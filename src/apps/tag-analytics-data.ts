import {CONFIG, DAY_MS} from '../config';
import {createLogger} from '../core/logger';
import {RateLimitedFetch} from '../core/rate-limiter';
import type {Database} from '../core/database';
import type {
  DanbooruPost,
  DanbooruTag,
  DanbooruUser,
  DanbooruRelatedTag,
  DanbooruRelatedTagResponse,
  DanbooruCountResponse,
  DanbooruTagImplication,
  HistoryEntry,
  MilestoneEntry,
  UserRanking,
  TagAnalyticsMeta,
  MonthlyCountRecord,
  TagImplicationCacheRecord,
} from '../types';

type MonthlyCountsData = HistoryEntry[] & {historyCutoff?: string};

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
};

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
// Tag implications cache (top-level tag detection)
// ---------------------------------------------------------------------------

/** TTL for persisted implication lookups. tag_implications is near-immutable. */
export const IMPLICATIONS_CACHE_TTL_MS = 180 * CACHE_DAY_MS;

/** Max tag names per batched /tag_implications.json call (URL-length budget). */
export const IMPLICATIONS_BATCH_CHUNK_SIZE = 50;

/**
 * Module-level in-memory cache for top-level flags. Populated from the
 * persistent table on first read and by every successful batch fetch, so
 * repeat lookups within a session cost zero I/O.
 */
const topLevelSessionCache = new Map<string, boolean>();

/** Resets the session cache — exported for tests. */
export function resetTopLevelSessionCache(): void {
  topLevelSessionCache.clear();
}

/**
 * Parses a /tag_implications.json batch response into a `name → isTopLevel`
 * map for a given input chunk. Tags present in the chunk but not in the
 * response are top-level (no implications); tags appearing as
 * `antecedent_name` in any implication are NOT top-level.
 *
 * Pure / exported for testing.
 */
export function parseImplicationsResponse(
  chunk: string[],
  imps: unknown,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  chunk.forEach(name => result.set(name, true));
  if (Array.isArray(imps)) {
    for (const imp of imps as Array<Partial<DanbooruTagImplication>>) {
      const name = imp?.antecedent_name;
      if (name && result.has(name)) {
        result.set(name, false);
      }
    }
  }
  return result;
}

/**
 * Checks whether a persistent implication cache record is still fresh.
 * Exported for tests.
 */
export function isImplicationCacheValid(
  fetchedAt: number,
  now: number,
): boolean {
  const age = now - fetchedAt;
  return age >= 0 && age < IMPLICATIONS_CACHE_TTL_MS;
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

  constructor(db: Database, rateLimiter: RateLimitedFetch, tagName: string) {
    this.db = db;
    this.rateLimiter = rateLimiter;
    this.tagName = tagName;
    this.userNames = {};
  }

  /**
   * Loads the tag analytics report from the cache if not expired.
   * Cache is considered stale after 24 hours.
   * @return {Promise<?Object>} The cached data object or null if not found/expired.
   */
  async loadFromCache(): Promise<TagAnalyticsMeta | null> {
    if (!this.db || !this.db.tag_analytics) return null;
    try {
      const cached = await this.db.tag_analytics.get(this.tagName);
      if (cached) {
        // Check expiry (e.g. 24 hours)
        const age = Date.now() - cached.updatedAt;
        if (age < CONFIG.CACHE_EXPIRY_MS) {
          return {
            ...cached.data,
            updatedAt: cached.updatedAt,
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
      // Preserve `lastFullScanAt` across saves: either the value stashed by
      // `fetchMonthlyCounts` on first-visit full scan, or the existing
      // value on the record (subsequent saves must not wipe it).
      let lastFullScanAt: number | undefined;
      if (this._pendingLastFullScanAt !== null) {
        lastFullScanAt = this._pendingLastFullScanAt;
      } else {
        const existing = await this.db.tag_analytics.get(this.tagName);
        lastFullScanAt = existing?.lastFullScanAt;
      }

      await this.db.tag_analytics.put({
        tagName: this.tagName,
        updatedAt: Date.now(),
        data: data,
        lastFullScanAt,
      });
      this._pendingLastFullScanAt = null;
    } catch (e) {
      log.warn('Cache save failed', {error: e});
    }
  }

  /**
   * Bulk-reads monthly count cache entries for this tag.
   * Returns a Map keyed by `yearMonth` (missing entries are simply absent).
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
        if (r) result.set(yearMonths[i], r);
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
      }));
      await this.db.tag_monthly_counts.bulkPut(records);
    } catch (e) {
      log.warn('Failed to write monthly counts cache', {error: e});
    }
  }

  /**
   * Batched `/tag_implications.json` lookup for top-level detection.
   *
   * Only entries from successfully-fetched chunks are included in the
   * returned map. A chunk failure leaves its tags absent (safe fallback:
   * callers treat absent as "unknown → default true" without caching).
   *
   * Batch size caps URL length; Danbooru's `antecedent_name_comma` supports
   * multi-name lookups so 20-tag candidate sets collapse to one request.
   */
  private async fetchTopLevelTagsBatch(
    tagNames: string[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (tagNames.length === 0) return result;

    for (let i = 0; i < tagNames.length; i += IMPLICATIONS_BATCH_CHUNK_SIZE) {
      const chunk = tagNames.slice(i, i + IMPLICATIONS_BATCH_CHUNK_SIZE);
      const url = `/tag_implications.json?search[antecedent_name_comma]=${encodeURIComponent(chunk.join(','))}&limit=1000`;
      try {
        const imps = await this.rateLimiter
          .fetch(url)
          .then((r: Response) => r.json());
        const parsed = parseImplicationsResponse(chunk, imps);
        parsed.forEach((v, k) => result.set(k, v));
      } catch (e) {
        log.warn('Batch tag_implications fetch failed', {
          error: e,
          chunkSize: chunk.length,
        });
        // Leave this chunk's tags unset in result — caller falls back to
        // safe default (true) without caching the unreliable answer.
      }
    }

    return result;
  }

  /**
   * Reads persisted top-level flags for the requested tags, honoring the
   * 180-day TTL and populating the session cache along the way. Returns a
   * map only for cache-hit entries; missing/expired entries are absent.
   */
  private async readImplicationCache(
    tagNames: string[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (tagNames.length === 0) return result;

    // 1) Session cache fast path.
    const missing: string[] = [];
    for (const name of tagNames) {
      const hit = topLevelSessionCache.get(name);
      if (hit !== undefined) {
        result.set(name, hit);
      } else {
        missing.push(name);
      }
    }

    if (missing.length === 0 || !this.db?.tag_implications_cache) {
      return result;
    }

    // 2) Persistent store lookup, filtered by 180d TTL.
    try {
      const now = Date.now();
      const records = await this.db.tag_implications_cache.bulkGet(missing);
      records.forEach((r, i) => {
        if (r && isImplicationCacheValid(r.fetchedAt, now)) {
          result.set(missing[i], r.isTopLevel);
          topLevelSessionCache.set(missing[i], r.isTopLevel);
        }
      });
    } catch (e) {
      log.warn('Failed to read tag_implications cache', {error: e});
    }

    return result;
  }

  /**
   * Persists successfully-fetched top-level flags. Session cache is updated
   * atomically; persistent write is best-effort (failures log a warning).
   */
  private async writeImplicationCache(
    entries: Map<string, boolean>,
  ): Promise<void> {
    if (entries.size === 0) return;

    // Update session cache unconditionally — fast, synchronous, always safe.
    entries.forEach((isTopLevel, tagName) => {
      topLevelSessionCache.set(tagName, isTopLevel);
    });

    if (!this.db?.tag_implications_cache) return;
    try {
      const now = Date.now();
      const records: TagImplicationCacheRecord[] = [];
      entries.forEach((isTopLevel, tagName) => {
        records.push({tagName, isTopLevel, fetchedAt: now});
      });
      await this.db.tag_implications_cache.bulkPut(records);
    } catch (e) {
      log.warn('Failed to write tag_implications cache', {error: e});
    }
  }

  /**
   * Resolves top-level flags for a list of tags using cache-first strategy.
   * Cache hits are served immediately; misses are batch-fetched and
   * persisted. Tags still unresolved after a failed batch fall back to
   * `true` (treat-as-top-level) so filtering stays permissive.
   *
   * Public so `TagAnalyticsApp._fetchPostTags` can share the same cache +
   * batch pipeline for its copyright-candidate filter.
   */
  async getTopLevelFlags(tagNames: string[]): Promise<Map<string, boolean>> {
    const cached = await this.readImplicationCache(tagNames);
    const missing = tagNames.filter(n => !cached.has(n));
    if (missing.length === 0) return cached;

    const fetched = await this.fetchTopLevelTagsBatch(missing);
    if (fetched.size > 0) {
      await this.writeImplicationCache(fetched);
    }

    // Merge: fetched → cached, and fill remaining gaps with the safe
    // default (true) without persisting them.
    for (const name of missing) {
      if (fetched.has(name)) {
        cached.set(name, fetched.get(name) as boolean);
      } else {
        cached.set(name, true);
      }
    }
    return cached;
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
   * Fetches the count of new posts within the last 24 hours.
   * @param {string} tagName - The tag to analyze.
   * @return {Promise<number>} - Count of posts created in the last 24 hours.
   */
  async fetchCountWithRetry(url: string, retries: number = 1): Promise<number> {
    for (let i = 0; i <= retries; i++) {
      try {
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();

        const count =
          data && data.counts && typeof data.counts === 'object'
            ? data.counts.posts
            : data
              ? data.posts
              : undefined;

        if (count !== undefined && count !== null) {
          return count;
        }

        // If undefined, it's a "bad" response for our purpose, treat as error to trigger retry
        throw new Error('Invalid count data');
      } catch (e) {
        if (i === retries) {
          log.warn(`Failed to fetch count after ${retries + 1} attempts`, {
            url,
            error: e,
          });
          return 0; // Default to 0 after all retries
        }
        // Wait a bit before retry (e.g., 500ms)
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
      total: `tags=${encodeURIComponent(tagName)}+has:commentary`,
      translated: `tags=${encodeURIComponent(tagName)}+has:commentary+commentary`,
      requested: `tags=${encodeURIComponent(tagName)}+has:commentary+commentary_request`,
    };

    const results: Record<string, number> = {};

    const keys = Object.keys(queries);
    await Promise.all(
      keys.map(async key => {
        const query = queries[key];
        const url = `/counts/posts.json?${query}`;
        results[key] = await this.fetchCountWithRetry(url);
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
   * Fetches post counts for each status (active, deleted, etc.).
   * @param {string} tagName - The tag to analyze.
   * @return {Promise<Object>} - Map of status strings to counts.
   */
  async fetchStatusCounts(tagName: string): Promise<Record<string, number>> {
    const statuses = [
      'active',
      'appealed',
      'banned',
      'deleted',
      'flagged',
      'pending',
    ];
    const results: Record<string, number> = {};

    const tasks = statuses.map(async status => {
      const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+status:${status}`;
      results[status] = await this.fetchCountWithRetry(url);
    });

    await Promise.all(tasks);

    // [Integrity Check] Ensure all keys exist and are valid numbers
    statuses.forEach(status => {
      if (results[status] === undefined) {
        log.warn(`Missing status key: ${status}. Defaulting to 0.`);
        results[status] = 0;
      }
    });

    return results;
  }

  /**
   * Fetches post counts for all ratings (g, s, q, e) for a tag.
   * @param {string} tagName The tag name.
   * @param {?string} startDate Optional start date (YYYY-MM-DD) to optimize query.
   * @return {Promise<!Object<string, number>>} Map of rating characters to counts.
   */
  async fetchRatingCounts(
    tagName: string,
    startDate: string | null = null,
  ): Promise<Record<string, number>> {
    const ratings = ['g', 's', 'q', 'e'];
    const results: Record<string, number> = {};

    const tasks = ratings.map(async rating => {
      let qs = `tags=${encodeURIComponent(tagName)}+rating:${rating}`;
      if (startDate) {
        qs += `+date:>=${startDate}`;
      }
      const url = `/counts/posts.json?${qs}`;
      results[rating] = await this.fetchCountWithRetry(url);
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

  async fetchRelatedTagDistribution(
    tagName: string,
    categoryId: number,
    totalTagCount: number,
    opts: {
      /**
       * Optional SWR hook. When provided, initial approximate counts are
       * returned immediately and exact `/counts/posts.json` lookups run
       * in the background, invoking `onExactCounts` once complete. Omit
       * to disable SWR (returns approximations only, no background fetch).
       */
      onExactCounts?: (counts: Record<string, number>) => void;
    } = {},
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
      //    No per-combination /counts/posts.json queries here — the SWR
      //    background fetch below supplies exact values without blocking
      //    the initial render.
      const slices = buildDistributionApprox(filtered, totalTagCount);
      const approxResult = distributionToCountMap(slices);

      // 4. SWR: kick off exact per-combination count fetches in the
      //    background. Fire-and-forget; callers that opted in via
      //    `opts.onExactCounts` receive the refined map when ready.
      if (opts.onExactCounts && slices.length > 0) {
        void this.revalidateRelatedTagCounts(
          tagName,
          slices,
          opts.onExactCounts,
        );
      }

      return approxResult;
    } catch (e) {
      log.warn(`Failed to fetch ${catName} distribution`, {error: e});
      return null;
    }
  }

  /**
   * Background refetch of exact per-combination counts (SWR swap-in).
   *
   * Runs 10 parallel `/counts/posts.json` queries through the rate-limited
   * queue; per-slice failures keep the approximate count instead. Errors
   * are logged at debug level so a noisy network doesn't spam the console.
   */
  private async revalidateRelatedTagCounts(
    tagName: string,
    slices: DistributionSlice[],
    onExactCounts: (counts: Record<string, number>) => void,
  ): Promise<void> {
    try {
      const fetchable = slices.filter(s => !s.isOther);
      const resolved: Record<string, number> = {};

      await Promise.all(
        fetchable.map(async slice => {
          try {
            const query = `${tagName} ${slice.key}`;
            const cUrl = `/counts/posts.json?tags=${encodeURIComponent(query)}`;
            const cResp = await this.rateLimiter
              .fetch(cUrl)
              .then((r: Response) => r.json());
            const exact =
              (cResp && cResp.counts
                ? cResp.counts.posts
                : cResp
                  ? cResp.posts
                  : 0) || 0;
            resolved[slice.key] = exact;
          } catch (e) {
            log.debug('SWR exact count fetch failed, keeping approx', {
              tag: slice.key,
              error: e,
            });
            resolved[slice.key] = slice.count;
          }
        }),
      );

      // Pass-through the "Others" slice — it's already an aggregate
      // estimate from (1 - cumulative frequency) × totalCount.
      const others = slices.find(s => s.isOther);
      if (others) resolved[others.key] = others.count;

      onExactCounts(resolved);
    } catch (e) {
      log.debug('SWR revalidation aborted', {error: e});
    }
  }

  async fetchHistoryBackwards(
    tagName: string,
    forwardStartDate: string,
    targetTotal: number,
    currentForwardTotal: number,
  ): Promise<HistoryEntry[]> {
    log.debug('Starting Reverse Scan', {
      tag: tagName,
      start: forwardStartDate,
      target: targetTotal,
      current: currentForwardTotal,
    });
    const history: HistoryEntry[] = [];
    let totalSum = currentForwardTotal;
    const currentMonth = new Date(forwardStartDate);

    // We strictly start scanning from 1 month before the forward start date
    // to avoid overlapping with fetchMonthlyCounts which already covers the starting month.
    currentMonth.setMonth(currentMonth.getMonth() - 1); // Start from month BEFORE forward scan

    // Danbooru founded in late 2005. Don't go past that.
    const hardLimit = new Date('2005-01-01');

    while (totalSum < targetTotal && currentMonth > hardLimit) {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth() + 1;

      // Use next month's 1st day as end of range to include the last day of current month fully
      const nextDate = new Date(currentMonth);
      nextDate.setMonth(nextDate.getMonth() + 1);
      const nYear = nextDate.getFullYear();
      const nMonth = nextDate.getMonth() + 1;

      const dateRange = `${year}-${String(month).padStart(2, '0')}-01...${nYear}-${String(nMonth).padStart(2, '0')}-01`;
      const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+date:${dateRange}`;

      try {
        const data = await this.rateLimiter
          .fetch(url)
          .then((r: Response) => r.json());
        const count =
          data.counts && typeof data.counts === 'object'
            ? data.counts.posts || 0
            : data.counts || 0;

        if (count > 0) {
          history.unshift({
            date: `${year}-${String(month).padStart(2, '0')}-01`,
            count: count,
            cumulative: 0, // Will fix in post-process
          });
          totalSum += count;
          log.debug(`Reverse Scan Hit: ${year}-${month}`, {
            count,
            total: totalSum,
            target: targetTotal,
          });
        }
      } catch (e) {
        log.warn(`Backward fetch failed for ${year}-${month}`, {error: e});
      }

      currentMonth.setMonth(currentMonth.getMonth() - 1);
    }
    log.debug('Reverse Scan Completed', {
      total: totalSum,
      target: targetTotal,
      hitsCount: history.length,
    });

    // Calculate cumulative counts for backward data
    let runningSum = 0;
    for (let i = 0; i < history.length; i++) {
      runningSum += history[i].count;
      history[i].cumulative = runningSum;
    }

    return history;
  }

  async fetchHistoryDelta(
    tagName: string,
    lastDate: Date | string,
    startDate: Date | string,
  ): Promise<HistoryEntry[]> {
    if (!lastDate) {
      // Falling through to full scan — let the caching layer treat it as such.
      return this.fetchMonthlyCounts(tagName, startDate, {isFullScan: true});
    }

    // Delta Sync: Check last 2 months only
    const now = new Date();
    const twoMonthsAgo = new Date(now);
    twoMonthsAgo.setMonth(now.getMonth() - 2);
    twoMonthsAgo.setDate(1); // Start from 1st of month

    const effectiveStart =
      lastDate && lastDate > twoMonthsAgo
        ? twoMonthsAgo
        : lastDate || startDate;

    // Delta path: isFullScan=false (default) so forced-rescan/drift guard
    // stay idle; the two months in range are always TTL-stale and get fetched.
    return this.fetchMonthlyCounts(tagName, effectiveStart);
  }

  mergeHistory(
    oldHistory: HistoryEntry[] | null,
    newHistory: HistoryEntry[] | null,
  ): HistoryEntry[] {
    if (!oldHistory || oldHistory.length === 0) return newHistory ?? [];
    if (!newHistory || newHistory.length === 0) return oldHistory;

    // Map old history by date string (YYYY-MM-DD or time) for easy lookup?
    // Actually, standard is array of objects { date: Date, count: number, cumulative: number }
    // newHistory starts from lastDate.

    // Remove overlapping months from oldHistory
    // We keep old history UP TO the month before newStart.
    // newStart is likely YYYY-MM-DD. We want to avoid duplication.
    // fetchMonthlyCounts returns dates as YYYY-MM-01.

    const newStart = newHistory[0].date;
    const filteredOld = oldHistory.filter(h => h.date < newStart);

    // Concatenate
    let merged = filteredOld.concat(newHistory);

    // Recalculate Cumulative strictly from start
    // Note: This assumes the first item in merged has correct 'count' but 'cumulative' might need offset if we cropped pure start.
    // But we are appending to a base.

    // If we cut the tail of oldHistory, the last item of filteredOld has a cumulative count.
    // We can just iterate and update.

    let runningSum = 0;
    merged = merged.map(h => {
      // We can't just sum 'count' unless we are sure we have the WHOLE history from 2005.
      // partial sync means we have (Old - Tail) + New.
      // So valid history.
      runningSum += h.count;
      return {...h, cumulative: runningSum};
    });

    return merged;
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
    // Query for posts created in the last 24 hours (age:..1d)
    const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+age:..1d`;
    try {
      const resp = await this.rateLimiter
        .fetch(url)
        .then((r: Response) => r.json());
      return (
        (resp && resp.counts ? resp.counts.posts : resp ? resp.posts : 0) || 0
      );
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

  async fetchReportRanking(
    tagName: string,
    group: string,
    from: string,
    to: string,
  ): Promise<ReportEntry[]> {
    // group: 'uploader' or 'approver'
    // from/to: YYYY-MM-DD
    const params = new URLSearchParams({
      'search[tags]': tagName,
      'search[group]': group,
      'search[mode]': 'table',
      'search[group_limit]': '10', // Top 100
      commit: 'Search',
    });

    if (from) params.append('search[from]', from);
    if (to) params.append('search[to]', to);

    const url = `/reports/posts.json?${params.toString()}`;
    try {
      const resp = await this.rateLimiter.fetch(url, {
        headers: {Accept: 'application/json'},
      });
      const data = await resp.json();

      return data;
      // Let's verify format. The user provided link returns a standard JSON structure?
      // Actually reports/posts.json returns HTML table row data usually?
      // Wait, user provided: reports/posts.json?...
      // Let's assume it returns JSON with [ { id, count, ... } ] or similar.
      // If it returns HTML, I might need to parse, but usually .json returns JSON.
      // Based on Danbooru API, reports usually return a string or specific structure.
      // For 'uploader', it returns list of objects.
    } catch (e) {
      log.warn(`Ranking fetch failed (${group})`, {error: e});
      return [];
    }
  }

  // -----------------------------------

  /**
   * Fetches monthly post counts for the tag since the start date.
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

    const startYear = startDateObj.getFullYear();
    const startMonth = startDateObj.getMonth(); // 0-based

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

      // Danbooru counts API needs the date filter INSIDE the tags parameter
      let rangeEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

      // [OPTIMIZATION] Cap range at NOW when the month is the current one to
      // avoid race conditions with posts added during the fetch.
      if (nextMonth > now) {
        rangeEnd = now.toISOString();
      }

      const queryDate = `${y}-${String(m).padStart(2, '0')}-01...${rangeEnd}`;

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
      fetchTasks.map(task => {
        const params = new URLSearchParams({
          tags: `${tagName} status:any date:${task.queryDate}`,
        });
        const url = `/counts/posts.json?${params.toString()}`;

        return this.rateLimiter
          .fetch(url)
          .then((r: Response) => r.json())
          .then((data: DanbooruCountResponse) => {
            const count =
              (data && data.counts
                ? data.counts.posts
                : data
                  ? data.posts
                  : 0) || 0;
            return {
              date: task.dateStr,
              yearMonth: task.yearMonth,
              count,
              ok: true as const,
            };
          })
          .catch((e: unknown) => {
            log.warn(`Failed month ${task.dateStr}`, {error: e});
            return {
              date: task.dateStr,
              yearMonth: task.yearMonth,
              count: 0,
              ok: false as const,
            };
          });
      }),
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
    monthlyData.historyCutoff = now.toISOString();
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
   * Identifies milestone posts (e.g., 100th, 1000th) from the monthly data.
   * Precision depends on the granularity of the monthly data.
   * @param {string} tagName The tag name.
   * @param {!Array<{date: !Date, count: number, cumulative: number}>} monthlyData The history data.
   * @param {!Array<number>} targets The milestone targets (e.g., [1, 100, 1000]).
   * @return {Promise<!Array<{milestone: number, post: ?Object}>>} Array of milestones.
   */
  async fetchMilestones(
    tagName: string,
    monthlyData: HistoryEntry[],
    targets: number[],
  ): Promise<MilestoneEntry[]> {
    const milestones: MilestoneEntry[] = [];

    // Sort targets
    targets.sort((a, b) => a - b);

    if (!monthlyData || monthlyData.length === 0) return [];

    for (const target of targets) {
      // Find month where accum >= target
      // monthlyData is sorted by date asc
      let targetData = null;
      let prevCumulative = 0;

      for (const mData of monthlyData) {
        if (mData.cumulative >= target) {
          targetData = mData;
          break;
        }
        prevCumulative = mData.cumulative;
      }

      if (targetData) {
        const offset = target - prevCumulative;

        // targetData.date is a "YYYY-MM-01" string (HistoryEntry.date: string)
        let y, m;
        {
          const dParts = targetData.date.split('-');
          y = parseInt(dParts[0], 10);
          m = parseInt(dParts[1], 10); // 1-12
        }

        // Date(y, m-1, 0) gives last day of prev month
        // Month is 0-indexed in Date constructor.
        // m is 1-based (Feb=2). Date(2020, 1, 1) is Feb 1.
        // We want last day of Jan. Date(2020, 0, 0)? No.
        // Date(year, monthIndex, 0) is the last day of the *previous* month.
        // So Date(2020, 1, 0) is Jan 31? Yes.
        // targetData.date is 2020-02-01. m=2.
        // new Date(y, m - 1, 0) -> new Date(2020, 1, 0) -> 2020-01-31.

        const prevMonthEnd = new Date(y, m - 1, 0);
        // Format to YYYY-MM-DD
        const prevDateStr = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(prevMonthEnd.getDate()).padStart(2, '0')}`;

        const limit = 200;
        const page = Math.ceil(offset / limit);
        const indexInPage = (offset - 1) % limit;

        // Query
        // Note: order:id assumes IDs increase with time. Usually true but imported posts might break this.
        // User asked for "date:>..." and "offset".
        // We must use order:id to ensure deterministic sort matching the "count" order roughly.
        // Actually "count" is just total.
        const params = new URLSearchParams({
          tags: `${tagName} status:any date:>${prevDateStr} order:id`,
          limit: String(limit),
          page: String(page),
          only: 'id,created_at,uploader_id,uploader_name,variants,rating,preview_file_url',
        });

        const url = `/posts.json?${params.toString()}`;

        try {
          const posts: DanbooruPost[] = await this.rateLimiter
            .fetch(url)
            .then((r: Response) => r.json());
          if (posts && posts[indexInPage]) {
            milestones.push({
              milestone: target,
              post: posts[indexInPage],
            } as MilestoneEntry);
          } else {
            log.warn(`Milestone ${target} post not found`, {
              index: indexInPage,
              page,
              postsLen: posts ? posts.length : 0,
            });
          }
        } catch (e) {
          log.warn(`Failed milestone ${target}`, {error: e});
        }
      }
    }

    // Batch Fetch Uploaders for Milestones
    await this.backfillUploaderNames(milestones);

    return milestones;
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
    // 1. Fetch all rankings in parallel (RateLimiter queues them)
    const [uAll, aAll, uYear, aYear] = await Promise.all([
      measure(
        'Ranking (Uploader All)',
        this.fetchReportRanking(
          tagName,
          'uploader',
          '2005-01-01',
          dateStrTomorrow,
        ),
      ),
      measure(
        'Ranking (Approver All)',
        this.fetchReportRanking(
          tagName,
          'approver',
          '2005-01-01',
          dateStrTomorrow,
        ),
      ),
      measure(
        'Ranking (Uploader Year)',
        this.fetchReportRanking(
          tagName,
          'uploader',
          dateStr1Y,
          dateStrTomorrow,
        ),
      ),
      measure(
        'Ranking (Approver Year)',
        this.fetchReportRanking(
          tagName,
          'approver',
          dateStr1Y,
          dateStrTomorrow,
        ),
      ),
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

    const result = {
      uploaderAll: processReport(uAll),
      approverAll: processReport(aAll),
      uploaderYear: processReport(uYear),
      approverYear: processReport(aYear),
    };
    return result;
  }

  async fetchTagData(tagName: string): Promise<DanbooruTag | null> {
    try {
      // use name_matches to find the exact tag
      const url = `/tags.json?search[name_matches]=${encodeURIComponent(tagName)}`;
      const resp = await this.rateLimiter
        .fetch(url)
        .then((r: Response) => r.json());

      if (Array.isArray(resp) && resp.length > 0) {
        // Find exact match to be safe
        const exact = resp.find(t => t.name === tagName);
        return exact || resp[0];
      }
      return null;
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
