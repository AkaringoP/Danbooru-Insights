import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {perfLogger} from '../core/perf-logger';
import type {Database} from '../core/database';
import type {ProfileContext} from '../core/profile-context';

/** Pre-fetched values from renderDashboard's pre-check phase. When provided,
 *  fetchDashboardData reuses them instead of calling the same APIs again. */
export interface PrefetchedDashboardData {
  syncStats: {count: number; lastSync: string | null};
  totalCount: number;
}

/**
 * Stale-while-revalidate pair: the cached value for immediate render, plus
 * an optional starter that the caller runs after the dashboard is visible.
 * When the cache was a miss, `data` is already fresh and `startRevalidate`
 * is undefined.
 *
 * The revalidate *must not* fire during fetchDashboardData — it would land
 * in the Promise.all's microtask queue and compete with the rate limiter
 * against the (cheap, cached) distribution fetches, inflating render.total.
 * Deferring to post-render keeps the blocking path lean.
 */
export interface SwrResult<T> {
  data: T;
  /** Kicks off the background fetch. Returns the original Promise for error
   *  handling; resolves with fresh data iff it differs from `data`. */
  startRevalidate?: () => Promise<T | null>;
}

/**
 * Reads cached data from piestats, prepares (but does not start) a
 * background fetch if found, and blocks only on cache miss.
 */
async function swrStats<T>(
  dataManager: AnalyticsDataManager,
  cacheKey: string,
  uploaderId: number,
  freshFetch: () => Promise<T>,
  label: string,
): Promise<SwrResult<T>> {
  // No uploader id → skip cache entirely, same behaviour as before.
  if (!uploaderId) {
    const data = await perfLogger.wrap(label, freshFetch);
    return {data};
  }

  const cached = (await dataManager.getStats(cacheKey, uploaderId)) as T | null;

  if (cached !== null) {
    // Deferred: caller must invoke startRevalidate() after render is visible.
    const startRevalidate = () =>
      perfLogger.wrap(`${label}.revalidate`, freshFetch).then(fresh => {
        // JSON compare is good enough: data here is serialisable (posts,
        // milestones, level events) and the DB round-trip inside freshFetch
        // already went through saveStats.
        const same = JSON.stringify(fresh) === JSON.stringify(cached);
        return same ? null : fresh;
      });
    return {data: cached, startRevalidate};
  }

  // Cache miss: block on the fetch and surface it under the main label so
  // the blocking cost is still visible in perf logs.
  const data = await perfLogger.wrap(label, freshFetch);
  return {data};
}

/**
 * Discriminated union for `PieSlice.details`. Replaces the historic
 * `any` typing so click-handler / legend-link branching can be checked
 * exhaustively at compile time and a typo on `details.rating` /
 * `details.tagName` no longer slides through to a broken URL at runtime.
 *
 * - `rating` (rating tab): `getRatingDistribution` returns `{rating, count, label}`.
 * - `status` (status tab): `getStatusDistribution` returns `{name, count, label}`.
 * - `tag`    (everything else): `DistributionItem`-shaped, possibly with
 *   `originalTag` / `untagged_*` sentinels.
 */
export type PieDetails =
  | {
      kind: 'rating';
      rating: 'g' | 's' | 'q' | 'e' | '';
      count: number;
      label?: string;
      thumb?: string | null;
    }
  | {
      kind: 'status';
      name: string;
      count: number;
      label?: string;
      thumb?: string | null;
    }
  | {
      kind: 'tag';
      tagName?: string;
      originalTag?: string;
      isOther?: boolean;
      count: number;
      thumb?: string | null;
      color?: string;
      frequency?: number;
      name?: string;
    };

/** Processed pie chart slice used for D3 rendering. */
export interface PieSlice {
  value: number;
  label: string;
  color: string;
  details: PieDetails;
}

/**
 * Data service for UserAnalyticsApp.
 * Handles data fetching and coordination with AnalyticsDataManager.
 */
export class UserAnalyticsDataService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Fetches all dashboard data in parallel.
   * @param context The profile context.
   * @param prefetched Optional results from renderDashboard's pre-check phase.
   *   When provided, syncStats/totalCount are reused instead of re-fetched
   *   (saves one DB scan + one API call, ~400-900ms depending on user size).
   * @return All data needed for the dashboard.
   */
  async fetchDashboardData(
    context: ProfileContext,
    prefetched?: PrefetchedDashboardData,
  ) {
    const dataManager = new AnalyticsDataManager(this.db);
    // context.targetUser is guaranteed non-null when called from UserAnalyticsApp
    // (main.ts validates via isValidProfile() before instantiation).

    const user = context.targetUser!;

    // NSFW State for milestones
    const nsfwKey = 'danbooru_grass_nsfw_enabled';
    const isNsfwEnabled = localStorage.getItem(nsfwKey) === 'true';

    // 1. Fetch Summary Stats first (Local DB) to get starting date for optimizations
    const summaryStats = await perfLogger.wrap(
      'dbi:net:fetchData:summaryStats',
      () => dataManager.getSummaryStats(user),
    );
    const {firstUploadDate} = summaryStats;

    // Kick randomPosts off in parallel but don't await it — the dashboard
    // shows a placeholder in the Random tab until this resolves. Random is
    // intentionally uncached (every open should produce a new pick), so it
    // would otherwise dominate the fetchData tail (~1.3s).
    const randomPostsPromise = perfLogger.wrap(
      'dbi:net:fetchData:randomPosts',
      () => dataManager.getRandomPosts(user),
    );

    const uploaderId = parseInt(user.id ?? '0');

    const [
      stats,
      total,
      otherDistributions,
      statusSwr,
      ratingSwr,
      topPostsSwr,
      recentPopularSwr,
      milestones1kSwr,
      scatterData,
      levelChangesSwr,
      timelineMilestones,
      tagCloudGeneral,
      userStats,
      needsBackfill,
    ] = await Promise.all([
      prefetched
        ? Promise.resolve(prefetched.syncStats)
        : perfLogger.wrap('dbi:net:fetchData:syncStats', () =>
            dataManager.getSyncStats(user),
          ),
      prefetched
        ? Promise.resolve(prefetched.totalCount)
        : perfLogger.wrap('dbi:net:fetchData:totalCount', () =>
            dataManager.getTotalPostCount(user),
          ),
      // Distributions that were already cache-first before this work:
      // they hit piestats immediately and need no SWR (their cache is
      // only warmed on explicit sync, which is the existing behaviour).
      perfLogger.wrap('dbi:net:fetchData:distributions', () =>
        Promise.all([
          dataManager.getCharacterDistribution(user),
          dataManager.getCopyrightDistribution(user),
          dataManager.getFavCopyrightDistribution(user),
          dataManager.getBreastsDistribution(user),
          dataManager.getHairLengthDistribution(user),
          dataManager.getHairColorDistribution(user),
          dataManager.getGenderDistribution(user),
          dataManager.getCommentaryDistribution(user),
          dataManager.getTranslationDistribution(user),
        ]).then(
          ([
            char,
            copy,
            favCopy,
            breasts,
            hairL,
            hairC,
            gender,
            commentary,
            translation,
          ]) => ({
            character: char,
            copyright: copy,
            fav_copyright: favCopy,
            breasts,
            hair_length: hairL,
            hair_color: hairC,
            gender,
            commentary,
            translation,
          }),
        ),
      ),
      // Status + Rating previously fired 10 API calls on every open
      // (6 status + 4 rating). Now cached with SWR — still fresh on the
      // next open after any state change.
      swrStats(
        dataManager,
        'status_dist',
        uploaderId,
        () => dataManager.getStatusDistribution(user, firstUploadDate, true),
        'dbi:net:fetchData:status',
      ),
      swrStats(
        dataManager,
        'rating_dist',
        uploaderId,
        () => dataManager.getRatingDistribution(user, firstUploadDate, true),
        'dbi:net:fetchData:rating',
      ),
      // SWR: return cached value now, revalidate in background. fresh fetch
      // uses forceRefresh=true so it bypasses the in-method cache and
      // overwrites piestats via saveStats.
      swrStats(
        dataManager,
        'top_posts_by_type',
        uploaderId,
        () => dataManager.getTopPostsByType(user, true),
        'dbi:net:fetchData:topPosts',
      ),
      swrStats(
        dataManager,
        'recent_popular_posts',
        uploaderId,
        () => dataManager.getRecentPopularPosts(user, true),
        'dbi:net:fetchData:recentPopular',
      ),
      swrStats(
        dataManager,
        `milestones_1000_${isNsfwEnabled ? '1' : '0'}`,
        uploaderId,
        () => dataManager.getMilestones(user, isNsfwEnabled, 1000, true),
        'dbi:net:fetchData:milestones1k',
      ),
      perfLogger.wrap('dbi:net:fetchData:scatterData', () =>
        dataManager.getScatterData(user),
      ),
      swrStats(
        dataManager,
        'level_change_history',
        uploaderId,
        () => dataManager.getLevelChangeHistory(user, true),
        'dbi:net:fetchData:levelChanges',
      ),
      perfLogger.wrap('dbi:net:fetchData:timelineMilestones', () =>
        dataManager.getTimelineMilestones(user),
      ),
      perfLogger.wrap('dbi:net:fetchData:tagCloudGeneral', () =>
        dataManager.getTagCloudData(user, 0),
      ),
      perfLogger.wrap('dbi:net:fetchData:userStats', () =>
        dataManager.getUserStats(user),
      ),
      perfLogger.wrap('dbi:net:fetchData:needsBackfill', () =>
        dataManager.needsPostMetadataBackfill(user),
      ),
    ]);

    // Recombine status + rating (SWR'd) with the other nine (cache-first).
    const distributions = {
      status: statusSwr.data,
      rating: ratingSwr.data,
      ...otherDistributions,
    };

    return {
      stats,
      total,
      summaryStats,
      distributions,
      statusStartRevalidate: statusSwr.startRevalidate,
      ratingStartRevalidate: ratingSwr.startRevalidate,
      topPosts: topPostsSwr.data,
      topPostsStartRevalidate: topPostsSwr.startRevalidate,
      recentPopularPosts: recentPopularSwr.data,
      recentPopularStartRevalidate: recentPopularSwr.startRevalidate,
      randomPostsPromise,
      milestones1k: milestones1kSwr.data,
      milestones1kStartRevalidate: milestones1kSwr.startRevalidate,
      scatterData,
      levelChanges: levelChangesSwr.data,
      levelChangesStartRevalidate: levelChangesSwr.startRevalidate,
      timelineMilestones,
      tagCloudGeneral,
      userStats,
      needsBackfill,
      dataManager,
    };
  }
}
