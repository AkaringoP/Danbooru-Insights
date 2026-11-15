import {CONFIG} from '../config';
import {createLogger} from './logger';
import type {RateLimitedFetch} from './rate-limiter';
import {readSyncMeta, viewerTimeZone} from './sync-meta';
import {
  classifySyncFetchError,
  SYNC_PAGE_MAX_ATTEMPTS,
  syncRetryDelayMs,
} from './fetch-retry';
import type {
  Metric,
  MetricData,
  TargetUser,
  GrassSettings,
  DanbooruPost,
} from '../types';

const log = createLogger('DataManager');

/** A daily count entry stored in IndexedDB. */
interface DailyEntry {
  id: string;
  userId: string;
  date: string;
  count: number;
}

/** An approval detail entry stored in IndexedDB. */
interface ApprovalDetailEntry {
  id: string;
  userId: string;
  post_list: number[];
}

/** An hourly stats entry stored in IndexedDB. */
interface HourlyStatEntry {
  id: string;
  userId: string;
  metric: Metric;
  year: number;
  hour: number;
  count: number;
}

/** A raw API item with dynamic shape from Danbooru endpoints. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiItem = Record<string, any>;

/**
 * `/counts/posts.json` answered without a number — `{"counts":{"posts":null}}`
 * with HTTP 200 when Danbooru could not finish the count in time. It is not
 * a 0, and asking again soon does not help: the server caches that `null`
 * for 5 minutes (`app/logical/post_query.rb`).
 */
export class CountUnavailableError extends Error {
  constructor(readonly tags: string) {
    super('Count unavailable: the server returned no number');
    this.name = 'CountUnavailableError';
  }
}

/**
 * Fetches the total post count for a given tag query via
 * `/counts/posts.json`. Throws `Error('HTTP <status>')` on an HTTP error and
 * {@link CountUnavailableError} when the reply holds no number.
 *
 * Standalone form for services that do not extend `DataManager` (e.g.
 * `TagAnalyticsDataService`). Subclasses of `DataManager` should prefer
 * the instance method `this.fetchRemoteCount(tags)` which delegates here.
 */
export async function fetchRemoteCount(
  rateLimiter: RateLimitedFetch,
  tags: string,
): Promise<number> {
  const url = `/counts/posts.json?tags=${encodeURIComponent(tags)}`;
  const resp = await rateLimiter.fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json: ApiItem = await resp.json();
  const count: unknown = json?.['counts']?.['posts'];
  if (typeof count !== 'number') throw new CountUnavailableError(tags);
  return count;
}

/**
 * Handles API requests and caching via Dexie.js.
 */
export class DataManager {
  baseUrl: string;
  // Dexie instance typed as any: dynamic schema accessed via table names at runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  rateLimiter: RateLimitedFetch;

  /**
   * Initializes the DataManager.
   * @param {Database} db The Dexie database instance.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any, rateLimiter: RateLimitedFetch) {
    this.baseUrl = window.location.origin;
    this.db = db;
    // Always the tab's one limiter (main.ts). A manager with a bucket of its
    // own would ignore the multi-tab split and the 429 pause, and double
    // the tab's rate alongside the shared one (G-1).
    this.rateLimiter = rateLimiter;
  }

  /**
   * Whether a user's rows are numbered without a gap: their count equals
   * the highest `no` (T-404, audit DA-07). Index reads only — a count on
   * `uploader_id` and the last key of `[uploader_id+no]`. A user without
   * rows is intact. A gap means rows went missing below the newest one
   * (a ghost prune, an old bug): the local pies would undercount, the
   * Grass would miss days (T-601), and only a sync from the start can
   * fill it. Here rather than on AnalyticsDataManager so Grass can ask.
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
   * Whether this user's synced `posts` rows can stand for their uploads
   * (T-601): a completed sync on record and none under way or marked for a
   * full one, no gap in the numbering, and rows written in the time zone
   * the page uses now — `created_at` carries the viewer's Danbooru zone,
   * and Grass keys a day by its first ten characters. Throws when the page
   * has no `localStorage` (the caller treats that as "no").
   */
  private async syncedPostsUsable(uploaderId: number): Promise<boolean> {
    if (!this.db.posts || !this.db.sync_meta) return false;
    const meta = await readSyncMeta(this.db, uploaderId);
    if (!meta || meta.syncStartedAt !== undefined || meta.needsFullSync) {
      return false;
    }
    if (!meta.timeZone || meta.timeZone !== viewerTimeZone()) return false;
    if (!localStorage.getItem(`danbooru_grass_last_sync_${uploaderId}`)) {
      return false;
    }
    return this.rowNumberingIntact(uploaderId);
  }

  /**
   * Fills a year of the uploads Grass from the synced `posts` rows instead
   * of paging `/posts.json` (T-601, audit DA-25): only for a year with
   * nothing cached, and only when {@link syncedPostsUsable}. The rows are
   * the user's with `created_at` in [startDate, endDate) by its date part —
   * the posts `date:<startDate>...<endDate>` finds in the viewer's zone —
   * keyed and hour-counted as {@link fetchAndPersistYear} does the API's
   * items, and written to the same tables in one transaction. What follows
   * is the usual path: a past year's integrity count checks the sum (a
   * mismatch refetches the year), the current year fetches from its last
   * day on. Any failure leaves the year to the API.
   * @return true when it wrote the year
   */
  private async fillUploadsYearFromPosts(args: {
    userInfo: TargetUser;
    userIdVal: string;
    year: number;
    startDate: string;
    endDate: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any;
  }): Promise<boolean> {
    const {userInfo, userIdVal, year, startDate, endDate, table} = args;
    const uploaderId = Number.parseInt(userInfo.id ?? '', 10);
    if (!uploaderId) return false;
    try {
      if (!(await this.syncedPostsUsable(uploaderId))) return false;
      const cached = await table
        .where('id')
        .between(
          `${userIdVal}_${startDate}`,
          `${userIdVal}_${year}-12-31￿`,
          true,
          true,
        )
        .last();
      if (cached) return false;

      const daily = new Map<string, number>();
      const hourly = new Array<number>(24).fill(0);
      await this.db.posts
        .where('[uploader_id+created_at]')
        .between([uploaderId, startDate], [uploaderId, endDate], true, false)
        .each((p: {created_at: string}) => {
          const date = String(p.created_at).slice(0, 10);
          daily.set(date, (daily.get(date) ?? 0) + 1);
          const hour = new Date(p.created_at).getHours();
          if (!Number.isNaN(hour) && hour >= 0 && hour < 24) hourly[hour]++;
        });
      if (daily.size === 0) return false;

      const days: DailyEntry[] = [...daily].map(([date, count]) => ({
        id: `${userIdVal}_${date}`,
        userId: userIdVal,
        date,
        count,
      }));
      const hours: HourlyStatEntry[] = hourly.map((count, h) => ({
        id: `${userIdVal}_uploads_${year}_${String(h).padStart(2, '0')}`,
        userId: userIdVal,
        metric: 'uploads',
        year,
        hour: h,
        count,
      }));
      await this.db.transaction(
        'rw',
        [table, this.db.hourly_stats],
        async () => {
          await table.bulkPut(days);
          await this.db.hourly_stats.bulkPut(hours);
        },
      );
      log.debug('Uploads year filled from synced posts', {
        year,
        days: days.length,
      });
      return true;
    } catch (e: unknown) {
      log.debug('Uploads year left to the API', {year, error: e});
      return false;
    }
  }

  /**
   * Fetches detail data for a single post (for hover preview cards). Uses a
   * minimal `only` parameter and returns the raw API response object.
   *
   * @param postId The post ID
   * @return The raw API post object, or null on failure
   */
  async fetchPostDetails(postId: number): Promise<DanbooruPost | null> {
    try {
      const url = `/posts/${postId}.json?only=id,created_at,score,fav_count,rating,media_asset[variants],preview_file_url,tag_string_artist,tag_string_copyright,tag_string_character`;
      const resp = await this.rateLimiter.fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data && data.id) return data;
    } catch (e) {
      log.warn(`Failed to fetch post details for post ${postId}`, {error: e});
    }
    return null;
  }

  /**
   * Retrieves cached statistics for a given user and key.
   *
   * When `maxAgeMs` is provided, records older than that age (relative to
   * `record.updated_at`) are treated as cache misses and return null —
   * callers then refetch and overwrite. This is the count-cache TTL path
   * used by /counts/posts.json-derived distributions (v9.6); pre-v9.6
   * callers pass nothing and get the original "trust cache until reset"
   * behaviour.
   *
   * @param {string} key The unique key for the stats (e.g., 'rating_dist').
   * @param {string|number} userId The user's ID.
   * @param {number} [maxAgeMs] Optional age cap in milliseconds.
   * @return {Promise<unknown>} The cached data or null if not found / expired.
   */
  async getStats(
    key: string,
    userId: string | number,
    maxAgeMs?: number,
  ): Promise<unknown> {
    try {
      const record = await this.db.piestats.get({key, userId});
      if (!record) return null;
      if (maxAgeMs !== undefined && record.updated_at) {
        const age = Date.now() - new Date(record.updated_at).getTime();
        // Negative ages (future-dated, clock skew) also miss so a corrupt
        // timestamp does not pin a stale value forever.
        if (age < 0 || age > maxAgeMs) return null;
      }
      return record.data;
    } catch (e: unknown) {
      log.warn('Failed to load stats cache', {error: e});
      return null;
    }
  }

  /**
   * Saves statistics to the cache.
   * @param {string} key The unique key for the stats.
   * @param {string|number} userId The user's ID.
   * @param {unknown} data The data to cache.
   * @return {Promise<void>}
   */
  async saveStats(
    key: string,
    userId: string | number,
    data: unknown,
  ): Promise<void> {
    try {
      await this.db.piestats.put({
        key,
        userId,
        data,
        updated_at: new Date().toISOString(),
      });
    } catch (e: unknown) {
      log.warn('Failed to save stats cache', {error: e});
    }
  }

  /**
   * Retrieves GrassApp layout settings for a specific user.
   * @param {string|number} userId The user's ID.
   * @return {Promise<GrassSettings|null>} The settings (width, xOffset) or null.
   */
  async getGrassSettings(
    userId: string | number,
  ): Promise<GrassSettings | null> {
    if (!userId) return null;
    try {
      return await this.db.grass_settings.get(userId.toString());
    } catch (e: unknown) {
      log.warn('Failed to load grass settings', {error: e});
      return null;
    }
  }

  /**
   * Saves GrassApp layout settings for a specific user.
   * @param {string|number} userId The user's ID.
   * @param {Record<string, unknown>} settings The settings to save.
   * @return {Promise<void>}
   */
  async saveGrassSettings(
    userId: string | number,
    settings: Record<string, unknown>,
  ): Promise<void> {
    if (!userId) return;
    try {
      await this.db.grass_settings.put({
        userId: userId.toString(),
        ...settings,
        updated_at: new Date().toISOString(),
      });
    } catch (e: unknown) {
      log.warn('Failed to save grass settings', {error: e});
    }
  }

  /**
   * Checks if a year is already marked as complete for a specific user and metric.
   * @param {string} userId
   * @param {Metric} metric
   * @param {number} year
   * @return {Promise<boolean>}
   */
  async checkYearCompletion(
    userId: string,
    metric: Metric,
    year: number,
  ): Promise<boolean> {
    const id = `${userId}_${metric}_${year}`;
    try {
      const record = await this.db.completed_years.get(id);
      return !!record;
    } catch (e: unknown) {
      log.warn('Failed to check year completion status', {error: e});
      return false;
    }
  }

  /**
   * Sum of a metric's cached daily counts over an inclusive date range.
   *
   * Rows are keyed `${userId}_${date}`, so a range read is a prefix scan on
   * the primary key. Callers must decide for themselves whether the cache is
   * trustworthy for the range — a 0 here means "no rows", which is only the
   * same as "no activity" once the year is known complete.
   *
   * @param {Metric} metric Which daily table to read.
   * @param {string} userId The `userId` half of the row key.
   * @param {string} startDate Inclusive `YYYY-MM-DD` lower bound.
   * @param {string} endDate Inclusive `YYYY-MM-DD` upper bound.
   * @return {Promise<number>} Summed counts (0 when nothing is cached).
   */
  async sumDailyCounts(
    metric: Metric,
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const table = this.db[metric];
    if (!table) return 0;
    try {
      const rows: DailyEntry[] = await table
        .where('id')
        .between(
          `${userId}_${startDate}`,
          `${userId}_${endDate}\uffff`,
          true,
          true,
        )
        .toArray();
      return rows.reduce((sum, row) => sum + (row.count || 0), 0);
    } catch (e: unknown) {
      log.warn('Failed to sum daily counts', {error: e, metric});
      return 0;
    }
  }

  /**
   * Marks a year as complete for a specific user and metric.
   * @param {string} userId
   * @param {Metric} metric
   * @param {number} year
   */
  async markYearComplete(
    userId: string,
    metric: Metric,
    year: number,
  ): Promise<void> {
    try {
      await this.db.completed_years.put({
        id: `${userId}_${metric}_${year}`,
        userId,
        metric,
        year,
        timestamp: Date.now(),
      });
    } catch (e: unknown) {
      log.warn('Failed to mark year complete', {error: e});
    }
  }

  /**
   * Fetches metric data for a specific year, leveraging caching and
   * efficient fetching strategies. Supports 'uploads', 'approvals', and
   * 'notes' metrics. Orchestrator only — the five private helpers below
   * (resolveMetricFetchConfig → runUploadsIntegrityCheck →
   * loadCachedYearState → fetchAndPersistYear → loadYearResultFromCache)
   * carry the actual logic.
   *
   * @param {Metric} metric - The metric type ('uploads' | 'approvals' | 'notes').
   * @param {TargetUser} userInfo - The target user's profile information.
   * @param {number} year - The specific year to fetch data for (e.g., 2026).
   * @param {Function|null} [onProgress=null] - Optional callback for reporting fetch progress (count).
   * @return {Promise<MetricData>} Returns an object containing daily counts map and hourly distribution array.
   */
  async getMetricData(
    metric: Metric,
    userInfo: TargetUser,
    year: number,
    onProgress: ((count: number) => void) | null = null,
  ): Promise<MetricData> {
    try {
      const cfg = this.resolveMetricFetchConfig(metric, userInfo, year);
      if (cfg === null) return {} as MetricData;
      const userIdVal = userInfo.id || userInfo.name;
      const isYearCompleteCache = await this.checkYearCompletion(
        userIdVal,
        metric,
        year,
      );

      // A year with nothing cached comes from the synced posts when they can
      // stand for it (T-601); the integrity count below then checks a past
      // year, and the current year fetches only what followed.
      if (metric === 'uploads' && !isYearCompleteCache) {
        await this.fillUploadsYearFromPosts({
          userInfo,
          userIdVal,
          year,
          startDate: cfg.startDate,
          endDate: cfg.endDate,
          table: cfg.table,
        });
      }

      const forceFullFetch = await this.runUploadsIntegrityCheck({
        metric,
        year,
        normalizedName: cfg.normalizedName,
        table: cfg.table,
        userIdVal,
        startDate: cfg.startDate,
        isYearCompleteCache,
      });

      const state = await this.loadCachedYearState({
        table: cfg.table,
        userIdVal,
        startDate: cfg.startDate,
        year,
        metric,
        forceFullFetch,
        isYearCompleteCache,
      });

      if (!isYearCompleteCache) {
        await this.fetchAndPersistYear({
          cfg,
          metric,
          year,
          userInfo,
          userIdVal,
          state,
          forceFullFetch,
          onProgress,
        });
      }

      return this.loadYearResultFromCache({
        table: cfg.table,
        userIdVal,
        startDate: cfg.startDate,
        year,
        metric,
        isYearCompleteCache,
        hourlyCounts: state.hourlyCounts,
      });
    } catch (e: unknown) {
      log.error('Metric data fetch failed', {error: e});
      throw e; // Propagate error to UI
    }
  }

  /**
   * Resolve the per-metric API endpoint + IndexedDB store + base query
   * params. The `/posts.json` endpoint caps at 200/page; the other two
   * endpoints allow up to 1000. Throws for the `notes` metric when
   * `userInfo.id` is missing (the .json endpoint requires it).
   */
  private resolveMetricFetchConfig(
    metric: Metric,
    userInfo: TargetUser,
    year: number,
  ): {
    endpoint: string;
    storeName: string;
    dateKey: string;
    idKey: string;
    params: Record<string, unknown>;
    normalizedName: string;
    startDate: string;
    endDate: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any;
  } | null {
    const startDate = `${year}-01-01`;
    const endDate = `${year + 1}-01-01`;
    const normalizedName = (userInfo.name || '').replace(/ /g, '_');
    const params: Record<string, unknown> = {
      limit: metric === 'uploads' ? 200 : 1000,
    };
    let endpoint = '';
    let storeName = '';
    const dateKey = 'created_at';
    let idKey = '';

    switch (metric) {
      case 'uploads':
        endpoint = '/posts.json';
        storeName = 'uploads';
        idKey = 'uploader_id';
        params['only'] = 'uploader_id,created_at';
        break;
      case 'approvals':
        endpoint = '/post_approvals.json';
        storeName = 'approvals';
        idKey = 'user_id';
        params['search[user_id]'] = userInfo.id;
        params['only'] = 'id,post_id,created_at';
        break;
      case 'notes':
        if (!userInfo.id) throw new Error('User ID required for Notes');
        endpoint = '/note_versions.json';
        storeName = 'notes';
        idKey = 'updater_id';
        params['search[updater_id]'] = userInfo.id;
        params['only'] = 'updater_id,created_at';
        break;
      default:
        // Unknown metric: signal "no config, return empty MetricData".
        // Preserves the original getMetricData contract of swallowing
        // unsupported metrics rather than throwing — older callers may
        // pass synthetic metric strings during onboarding.
        return null;
    }

    return {
      endpoint,
      storeName,
      dateKey,
      idKey,
      params,
      normalizedName,
      startDate,
      endDate,
      table: this.db[storeName],
    };
  }

  /**
   * Past-year uploads-only integrity check: compare the remote count
   * (via `/counts/posts.json`) against the local Dexie sum. On mismatch,
   * delete this year's local rows and return `true` to force a full
   * refetch downstream. Bail silently (return false) when the remote count
   * cannot be had — a network error, or a `null` count
   * ({@link CountUnavailableError}, which used to read as 0 and wipe the
   * year) — the cache is still usable, just possibly stale.
   */
  private async runUploadsIntegrityCheck(args: {
    metric: Metric;
    year: number;
    normalizedName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any;
    userIdVal: string;
    startDate: string;
    isYearCompleteCache: boolean;
  }): Promise<boolean> {
    const {
      metric,
      year,
      normalizedName,
      table,
      userIdVal,
      startDate,
      isYearCompleteCache,
    } = args;
    if (
      isYearCompleteCache ||
      metric !== 'uploads' ||
      year >= new Date().getFullYear()
    ) {
      return false;
    }

    try {
      // Align Remote check to strict year (Dec 31st) to match Local check
      const strictEndDate = `${year + 1}-01-01`;
      const checkRange = `${startDate}...${strictEndDate}`;
      const queryTags = `user:${normalizedName} date:${checkRange}`;

      const remoteCount = await this.fetchRemoteCount(queryTags);

      // Align Local check to match Remote (wide) range. Cursor iteration:
      // sum counts without loading all records into memory.
      const matchedEndDate = `${year}-12-31`;
      let localCount = 0;
      await table
        .where('id')
        .between(
          `${userIdVal}_${startDate}`,
          `${userIdVal}_${matchedEndDate}\uffff`,
          true,
          true, // Inclusive to match Remote's "..." behavior on Jan 1st
        )
        .each((cur: ApiItem) => {
          localCount += cur['count'] || 0;
        });

      if (remoteCount === localCount) return false;

      log.warn(`Data mismatch detected for ${year}, forcing full sync`, {
        remoteCount,
        localCount,
      });

      // Safe Deletion: Strictly delete up to Dec 31st of this year.
      // Using endDate (Jan 1st next year) + \uffff would also delete
      // "YYYY+1-01-01" because "YYYY+1-01-01" < "YYYY+1-01-01\uffff".
      const deleteEndDate = `${year}-12-31`;
      await table
        .where('id')
        .between(
          `${userIdVal}_${startDate}`,
          `${userIdVal}_${deleteEndDate}\uffff`,
          true,
          true,
        )
        .delete();

      return true;
    } catch (e: unknown) {
      log.warn('Integrity check failed (Network/API), proceeding with cache', {
        error: e,
      });
      return false;
    }
  }

  /**
   * Look up the last cached entry for this user/year and seed the
   * hourly-counts array from Dexie so the fetch loop can do delta merges
   * without double-counting. Skipped (returns the empty initial state)
   * when forceFullFetch is set or the year is fully cached.
   */
  private async loadCachedYearState(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any;
    userIdVal: string;
    startDate: string;
    year: number;
    metric: Metric;
    forceFullFetch: boolean;
    isYearCompleteCache: boolean;
  }): Promise<{
    fetchFromDate: string | null;
    lastEntry: ApiItem | null;
    hourlyCounts: number[];
  }> {
    const {
      table,
      userIdVal,
      startDate,
      year,
      metric,
      forceFullFetch,
      isYearCompleteCache,
    } = args;
    const hourlyCounts = new Array<number>(24).fill(0);
    let lastEntry: ApiItem | null = null;
    let fetchFromDate: string | null = null;

    if (!forceFullFetch && !isYearCompleteCache) {
      lastEntry = await table
        .where('id')
        .between(
          `${userIdVal}_${startDate}`,
          `${userIdVal}_${year}-12-31\uffff`,
          true,
          true,
        )
        .last();

      const existingHourlyStats: Array<{hour: number; count: number}> =
        await this.db.hourly_stats
          .where('id')
          .between(
            `${userIdVal}_${metric}_${year}_00`,
            `${userIdVal}_${metric}_${year}_24`,
            true,
            false,
          )
          .toArray();

      if (existingHourlyStats.length > 0) {
        existingHourlyStats.forEach(stat => {
          if (stat.hour >= 0 && stat.hour < 24) {
            hourlyCounts[stat.hour] = stat.count;
          }
        });
      }
    }

    if (lastEntry) {
      // Past year that has data → set fetchFromDate to Jan 1 of next
      // year to mark "no further fetch needed". Current year → apply
      // the 3-day safety buffer to the last entry's date.
      if (year < new Date().getFullYear()) {
        fetchFromDate = `${year + 1}-01-01`;
      } else {
        const lastDate = new Date(lastEntry['date']);
        lastDate.setDate(lastDate.getDate() - 3);
        fetchFromDate = lastDate.toISOString().slice(0, 10);
      }
    }

    return {fetchFromDate, lastEntry, hourlyCounts};
  }

  /**
   * Build the server-side range query, run the paginated fetch, aggregate
   * the raw items into daily counts + an hourly histogram (delta-merged
   * with the existing hourlyCounts so days in the overlap window aren't
   * double-counted), and atomically upsert daily/approvals_detail/
   * hourly_stats. Marks the year complete on past-year fetches.
   *
   * Mutates `state.hourlyCounts` in place — the orchestrator's final
   * cache read picks up the merged values.
   */
  private async fetchAndPersistYear(args: {
    cfg: {
      endpoint: string;
      params: Record<string, unknown>;
      dateKey: string;
      idKey: string;
      normalizedName: string;
      startDate: string;
      endDate: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      table: any;
    };
    metric: Metric;
    year: number;
    userInfo: TargetUser;
    userIdVal: string;
    state: {
      fetchFromDate: string | null;
      lastEntry: ApiItem | null;
      hourlyCounts: number[];
    };
    forceFullFetch: boolean;
    onProgress: ((count: number) => void) | null;
  }): Promise<void> {
    const {
      cfg,
      metric,
      year,
      userInfo,
      userIdVal,
      state,
      forceFullFetch,
      onProgress,
    } = args;
    const {
      endpoint,
      params,
      dateKey,
      idKey,
      normalizedName,
      startDate,
      endDate,
      table,
    } = cfg;
    const {fetchFromDate, lastEntry, hourlyCounts} = state;

    // [Strategy B] Server-side range filtering. Narrow endDate when we
    // have cached data for the current year — fetching to Jan 1 of NEXT
    // year forces the API to scan months of empty range.
    //
    // Symmetric ±3-day window around today:
    //   - Backward: the existing `lastEntry - 3 days` rollback (in
    //     loadCachedYearState) catches mis-aligned rows near the cache
    //     boundary.
    //   - Forward: +3 days catches (1) any future-dated posts (rare
    //     but possible — backend queueing / clock skew / rating
    //     review) and (2) any browser↔Danbooru timezone offset.
    //     Danbooru's `date:A...B` is upper-bound-exclusive AND
    //     evaluated in the user's configured TZ, while
    //     `toISOString()` serializes in UTC — so when the Danbooru TZ
    //     is ahead of UTC (e.g. KST = UTC+9), a +1 UTC cutoff falls on
    //     the very day the user is uploading and silently excludes
    //     today's posts. +3 days absorbs both concerns.
    const rangeStart = fetchFromDate || startDate;
    let effectiveEndDate = endDate;
    if (lastEntry && year === new Date().getFullYear()) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + 3);
      effectiveEndDate = cutoff.toISOString().slice(0, 10);
    }
    const fetchRange = `${rangeStart}...${effectiveEndDate}`;

    if (metric === 'uploads') {
      params['tags'] = `user:${normalizedName} date:${fetchRange}`;
    } else if (metric === 'notes' || metric === 'approvals') {
      params['search[created_at]'] = fetchRange;
    }

    // Delta fetch: we have cached data and are only fetching a small
    // range. Use batch size 1 to avoid wasted parallel requests that
    // return empty pages.
    const isDeltaFetch = !!lastEntry && !forceFullFetch;
    // A cached past year asks from Jan 1 of the next year to that same day,
    // an empty range (`a...b` excludes b): nothing to fetch (T-601 — a year
    // filled from the synced posts lands here after its integrity count).
    const items =
      rangeStart >= effectiveEndDate
        ? []
        : await this.fetchAllPages(
            endpoint,
            params,
            null,
            dateKey,
            'desc',
            onProgress,
            isDeltaFetch,
          );

    const dailyCounts: Record<string, {count: number; postList: number[]}> = {};

    items.forEach((item: ApiItem) => {
      const rawDate = item[dateKey] || item['created_at'];
      if (!rawDate) return;

      // Strict User ID Check
      if (
        userInfo.id &&
        item[idKey] &&
        String(item[idKey]) !== String(userInfo.id)
      ) {
        log.warn('ID mismatch, skipping item', {
          expected: userInfo.id,
          got: item[idKey],
          itemDate: rawDate,
        });
        return;
      }

      const dateStr = String(rawDate).slice(0, 10);
      if (!dailyCounts[dateStr]) {
        dailyCounts[dateStr] = {count: 0, postList: []};
      }
      dailyCounts[dateStr].count += 1;
      if (item['post_id']) {
        dailyCounts[dateStr].postList.push(item['post_id']);
      }

      // Hourly aggregation: strictly only add to hourly_stats if the
      // data is NEWER than what's in DB. Since existingHourlyStats
      // already covers up to lastEntry, adding counts from the
      // overlapped buffer period would double-count them. This freezes
      // the hourly distribution for the lastEntry day (today) until the
      // next day — preferable to corrupting the data with duplication.
      const isNewData =
        !lastEntry || String(rawDate).slice(0, 10) > lastEntry['date'];

      const itemDate = new Date(rawDate);
      const hour = itemDate.getHours();
      if (isNewData && !isNaN(hour) && hour >= 0 && hour < 24) {
        hourlyCounts[hour]++;
      }
    });

    const bulkData: DailyEntry[] = [];
    const detailData: ApprovalDetailEntry[] = [];

    Object.entries(dailyCounts).forEach(([date, entry]) => {
      const id = `${userIdVal}_${date}`;
      bulkData.push({id, userId: userIdVal, date, count: entry.count});
      if (metric === 'approvals') {
        detailData.push({id, userId: userIdVal, post_list: entry.postList});
      }
    });

    const hourlyBulk: HourlyStatEntry[] = [];
    hourlyCounts.forEach((count, h) => {
      hourlyBulk.push({
        id: `${userIdVal}_${metric}_${year}_${String(h).padStart(2, '0')}`,
        userId: userIdVal,
        metric,
        year,
        hour: h,
        count,
      });
    });

    await this.db.transaction(
      'rw',
      [table, this.db.approvals_detail, this.db.hourly_stats],
      async () => {
        if (bulkData.length > 0) {
          await table.bulkPut(bulkData);
        }
        if (detailData.length > 0) {
          await this.db.approvals_detail.bulkPut(detailData);
        }
        await this.db.hourly_stats.bulkPut(hourlyBulk);
      },
    );

    if (year < new Date().getFullYear()) {
      await this.markYearComplete(userIdVal, metric, year);
    }
  }

  /**
   * Read the full year's daily counts back out of Dexie and assemble the
   * result. When the year is fully cached we re-read hourly_stats from
   * scratch (the fetch path never ran, so `hourlyCounts` is still the
   * zero-filled initial array); otherwise we keep the in-memory hourly
   * array that fetchAndPersistYear just updated in place.
   */
  private async loadYearResultFromCache(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any;
    userIdVal: string;
    startDate: string;
    year: number;
    metric: Metric;
    isYearCompleteCache: boolean;
    hourlyCounts: number[];
  }): Promise<MetricData> {
    const {
      table,
      userIdVal,
      startDate,
      year,
      metric,
      isYearCompleteCache,
      hourlyCounts,
    } = args;

    const dataEndDate = `${year}-12-31`;
    const fullYearData: DailyEntry[] = await table
      .where('id')
      .between(
        `${userIdVal}_${startDate}`,
        `${userIdVal}_${dataEndDate}\uffff`,
        true,
        true,
      )
      .toArray();

    const resultMap: Record<string, number> = {};
    fullYearData.forEach(i => (resultMap[i.date] = i.count));

    let hourly = hourlyCounts;
    if (isYearCompleteCache) {
      const cachedHourly: Array<{hour: number; count: number}> =
        await this.db.hourly_stats
          .where('id')
          .between(
            `${userIdVal}_${metric}_${year}_00`,
            `${userIdVal}_${metric}_${year}_24`,
            true,
            false,
          )
          .toArray();
      hourly = new Array<number>(24).fill(0);
      cachedHourly.forEach(stat => {
        if (stat.hour >= 0 && stat.hour < 24) {
          hourly[stat.hour] = stat.count;
        }
      });
    }

    return {daily: resultMap, hourly};
  }

  /**
   * Clears the cache for a specific metric and user.
   * @param {Metric} _metric 'uploads', 'approvals', or 'notes'.
   * @param {TargetUser} userInfo User info object.
   * @return {Promise<boolean>} True if successful.
   */
  async clearCache(_metric: Metric, userInfo: TargetUser): Promise<boolean> {
    try {
      const userIdVal = userInfo.id || userInfo.name;
      const tablesToClear = [
        'uploads',
        'approvals',
        'approvals_detail',
        'notes',
        'completed_years',
        'hourly_stats',
      ];

      for (const storeName of tablesToClear) {
        const table = this.db[storeName];
        // Delete all entries for this user in this store
        const items = await table
          .where('userId')
          .equals(userIdVal)
          .primaryKeys();
        if (items.length > 0) {
          await table.bulkDelete(items);
        }
      }

      return true;
    } catch (e: unknown) {
      log.error('Clear cache failed', {error: e});
      return false;
    }
  }

  /**
   * One page, retried like the full sync's (T-603, audit DA-22): a 429, a
   * 5xx, a network failure or an unreadable body is asked again up to
   * {@link SYNC_PAGE_MAX_ATTEMPTS} times, each wait covering what is left
   * of the shared limiter's pause ({@link syncRetryDelayMs}). Before, four
   * 429s in a row — 1, 2 and 4 s apart, shorter than a long pause — failed
   * the year, and a network error failed it at once.
   */
  private async fetchPageWithRetry(
    url: string,
    page: number,
  ): Promise<ApiItem[]> {
    let failures = 0;
    for (;;) {
      try {
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      } catch (e: unknown) {
        failures++;
        const kind = classifySyncFetchError(e);
        if (kind === 'fatal' || failures >= SYNC_PAGE_MAX_ATTEMPTS) throw e;
        const waitMs = syncRetryDelayMs(
          kind,
          failures,
          this.rateLimiter.backoffRemainingMs(),
        );
        log.warn(`Page ${page} failed, retrying`, {
          page,
          kind,
          failures,
          waitMs,
          error: e instanceof Error ? e.message : String(e),
        });
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }

  /**
   * Fetches pages from an API endpoint until a stop condition is met.
   * Handles pagination and batching automatically.
   * @param {string} endpoint The API endpoint (e.g., '/posts.json').
   * @param {Record<string, unknown>} params Query parameters for the API.
   * @param {string|null} [stopDate=null] ISO Date string (YYYY-MM-DD). If encountered, stops fetching.
   * @param {string} [dateKey='created_at'] Key to check date against.
   * @param {string} [direction='desc'] Fetch direction ('desc' or 'asc').
   * @param {Function|null} [onProgress=null] Optional callback for reporting fetch progress (count).
   * @return {Promise<ApiItem[]>} List of all fetched items up to the stop condition.
   */
  // T-26 baseline: complexity 30. Page loop × stop-condition (date /
  // cursor / empty) × ascending vs descending direction (the per-page retry
  // is fetchPageWithRetry since T-603). Critical path used by every metric
  // fetch. Depth-7 nesting in the stopDate inner loop has a separate
  // per-line disable below.
  // eslint-disable-next-line complexity
  async fetchAllPages(
    endpoint: string,
    params: Record<string, unknown>,
    stopDate: string | null = null,
    dateKey = 'created_at',
    direction = 'desc',
    onProgress: ((count: number) => void) | null = null,
    isDelta = false,
  ): Promise<ApiItem[]> {
    let allItems: ApiItem[] = [];
    let page = 1;

    // Adaptive Batch Size: page 1 alone, then — only when it came back
    // full — 5 pages at a time for a full fetch, 3 for a delta (narrow
    // range, usually under a page). A full fetch used to ask 5 at once, so
    // a year under 200 uploads cost 4 empty answers (T-604, audit DA-12).
    const FULL_BATCH = 5;
    const DELTA_SCALE_UP = 3;
    let batchSize = 1;
    const isApprovals = endpoint.includes('/post_approvals.json');
    const DELAY_BETWEEN_BATCHES = 150;

    while (true) {
      const promises: Array<Promise<{page: number; data: ApiItem[]}>> = [];

      // 1. Prepare Batch Requests
      for (let i = 0; i < batchSize; i++) {
        const currentPage = page + i;
        // URLSearchParams requires string values; params contains mixed types at runtime

        const q = new URLSearchParams({
          ...params,
          page: currentPage,
        } as unknown as Record<string, string>);
        const url = `${this.baseUrl}${endpoint}?${q.toString()}`;

        // [New] Fetch Task with Limit, Random Delay & Retry for Approvals
        const fetchTask = async (): Promise<{
          page: number;
          data: ApiItem[];
        }> => {
          // 1. Random Start Delay (Approvals Only)
          if (isApprovals) {
            const delay = Math.floor(Math.random() * 300) + 200; // 200~500ms
            await new Promise(r => setTimeout(r, delay));
          }

          // 2. Retries as the full sync's (T-603)
          return {
            page: currentPage,
            data: await this.fetchPageWithRetry(url, currentPage),
          };
        };

        promises.push(
          fetchTask().catch((e: unknown) => {
            log.error(`Critical fetch error on page ${currentPage}`, {
              page: currentPage,
              error: e,
            });
            throw e; // Fail fast to prevent data corruption
          }),
        );
      }

      // 2. Execute Batch
      const batchResults = await Promise.all(promises);

      // Sort results by page number to process in order
      batchResults.sort((a, b) => a.page - b.page);

      let finished = false;

      // 3. Process Results
      for (const res of batchResults) {
        const json = res.data;
        if (!Array.isArray(json) || json.length === 0) {
          finished = true;
          continue;
        }

        // Check for stopDate in this page
        if (stopDate) {
          for (const item of json) {
            const itemDate = (item[dateKey] || '').slice(0, 10);

            if (itemDate) {
              let shouldStop = false;
              // T-26 baseline: max-depth 7. The asc/desc direction split sits
              // at the deepest level of the per-item stopDate inner loop;
              // hoisting it out would require duplicating the loop or
              // building a comparator just to satisfy the linter.
              /* eslint-disable max-depth */
              if (direction === 'desc') {
                // Descending: Stop if item is OLDER (smaller) than stopDate
                if (itemDate < stopDate) shouldStop = true;
              } else {
                // Ascending: Stop if item is NEWER (larger) than stopDate
                if (itemDate > stopDate) shouldStop = true;
              }
              /* eslint-enable max-depth */

              if (shouldStop) {
                finished = true;
                break; // Break item loop
              }
            }
            allItems.push(item);
          }
          if (finished) break; // Break page loop
        } else {
          allItems = allItems.concat(json);
        }

        if (onProgress) {
          onProgress(allItems.length);
        }

        if (json.length < (params['limit'] as number)) {
          finished = true;
        }
      }

      if (finished) break;

      // Advance page by the batch size used for THIS iteration's fetches,
      // not the potentially updated one.
      const fetchedBatch = batchSize;

      // Adaptive scale-up: page 1 came back full, so there is more — ask
      // the rest in parallel batches.
      if (page === 1) {
        const limit = params['limit'] as number;
        const firstPageFull = batchResults[0]?.data?.length === limit;
        if (firstPageFull) {
          batchSize = isDelta ? DELTA_SCALE_UP : FULL_BATCH;
        }
      }

      page += fetchedBatch;
      if (page > 1000) {
        log.warn('Hit safety page limit of 1000, stopping fetch');
        break;
      }
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
    return allItems;
  }

  /**
   * Fetches the promotion date (when user became Approver) if applicable.
   * @param {string} userName
   * @return {Promise<string|null>} Date string (YYYY-MM-DD) or null.
   */
  async fetchPromotionDate(userName: string): Promise<string | null> {
    try {
      const encodedName = encodeURIComponent(userName);
      // body_matches=to+Approver is a token AND search, so it also matches
      // later transitions whose body mentions Approver (e.g. "to Moderator
      // from Approver"). Fetch a small page and pick the oldest entry by
      // created_at to get the actual first promotion to Approver.
      const url = `${this.baseUrl}/user_feedbacks.json?search[body_matches]=to+Approver&search[category]=neutral&search[hide_bans]=No&search[user_name]=${encodedName}&limit=20`;

      const resp = await this.rateLimiter.fetch(url);
      if (!resp.ok) return null;
      const json: ApiItem[] = await resp.json();

      if (!Array.isArray(json) || json.length === 0) {
        return null; // Not found (maybe invited differently or too old)
      }

      const oldest = json
        .filter(item => typeof item['created_at'] === 'string')
        .map(item => String(item['created_at']))
        .sort()[0];

      return oldest ? oldest.slice(0, 10) : null;
    } catch (e: unknown) {
      log.warn('Failed to fetch promotion date', {error: e});
      return null;
    }
  }

  /**
   * Gets statistics about the cache usage across storage methods.
   * Calculates item counts and approximate byte sizes for IndexedDB and LocalStorage.
   * Static: it makes no requests, so the settings popover can call it
   * without a manager (which would need the tab's rate limiter).
   * @return {Promise<{indexedDB: {count: number, size: number}, localStorage: {count: number, size: number}}>} Object containing count and size stats.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static async getCacheStats(db: any): Promise<{
    indexedDB: {count: number; size: number};
    localStorage: {count: number; size: number};
  }> {
    const stats = {
      indexedDB: {
        count: 0,
        size: 0,
      },
      localStorage: {
        count: 0,
        size: 0,
      },
    };

    // 1. IndexedDB Stats
    try {
      const tables = ['uploads', 'approvals', 'notes'];
      for (const t of tables) {
        const c = await db[t].count();
        stats.indexedDB.count += c;
      }
      // Approximate size: navigator.storage (Origin total)
      if (navigator.storage && navigator.storage.estimate) {
        // StorageEstimate.usageDetails is non-standard; cast to access it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const est = (await navigator.storage.estimate()) as any;
        if (est.usageDetails && est.usageDetails.indexedDB) {
          stats.indexedDB.size = est.usageDetails.indexedDB;
        } else {
          stats.indexedDB.size = est.usage; // Fallback to total origin usage
        }
      }
    } catch (e: unknown) {
      log.warn('Failed to get IndexedDB stats', {error: e});
    }

    // 2. LocalStorage Stats
    let lsCount = 0;
    let lsSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CONFIG.STORAGE_PREFIX)) {
        lsCount++;
        const val = localStorage.getItem(k);
        if (val) lsSize += (k.length + val.length) * 2;
      }
    }
    stats.localStorage.count = lsCount;
    stats.localStorage.size = lsSize;

    return stats;
  }

  /**
   * Fetches the total post count for a given tag query.
   * @param {string} tags Tag query string.
   * @return {Promise<number>} Total count.
   */
  async fetchRemoteCount(tags: string): Promise<number> {
    return fetchRemoteCount(this.rateLimiter, tags);
  }
}
