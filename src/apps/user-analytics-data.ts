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
 * an optional promise that fetches fresh data in the background. When the
 * cache was a miss, `data` is already fresh and `revalidate` is undefined.
 */
export interface SwrResult<T> {
  data: T;
  /** Resolves with fresh data if it differs from `data`, otherwise null. */
  revalidate?: Promise<T | null>;
}

/**
 * Reads cached data from piestats, triggers a background fetch if found,
 * and blocks only on cache miss. Returned `revalidate` promise resolves
 * with the fresh value iff it differs from the cached one (shallow JSON
 * compare), so callers can skip re-render on no-op refreshes.
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
    const revalidate = perfLogger
      .wrap(`${label}.revalidate`, freshFetch)
      .then(fresh => {
        // JSON compare is good enough: data here is serialisable (posts,
        // milestones, level events) and the DB round-trip inside freshFetch
        // already went through saveStats.
        const same = JSON.stringify(fresh) === JSON.stringify(cached);
        return same ? null : fresh;
      });
    return {data: cached, revalidate};
  }

  // Cache miss: block on the fetch and surface it under the main label so
  // the blocking cost is still visible in perf logs.
  const data = await perfLogger.wrap(label, freshFetch);
  return {data};
}

/** Processed pie chart slice used for D3 rendering. */
export interface PieSlice {
  value: number;
  label: string;
  color: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any; // DistributionItem | StatusItem | RatingItem
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
      'render.fetchData.summaryStats',
      () => dataManager.getSummaryStats(user),
    );
    const {firstUploadDate} = summaryStats;

    // Kick randomPosts off in parallel but don't await it — the dashboard
    // shows a placeholder in the Random tab until this resolves. Random is
    // intentionally uncached (every open should produce a new pick), so it
    // would otherwise dominate the fetchData tail (~1.3s).
    const randomPostsPromise = perfLogger.wrap(
      'render.fetchData.randomPosts',
      () => dataManager.getRandomPosts(user),
    );

    const uploaderId = parseInt(user.id ?? '0');

    const [
      stats,
      total,
      distributions,
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
        : perfLogger.wrap('render.fetchData.syncStats', () =>
            dataManager.getSyncStats(user),
          ),
      prefetched
        ? Promise.resolve(prefetched.totalCount)
        : perfLogger.wrap('render.fetchData.totalCount', () =>
            dataManager.getTotalPostCount(user),
          ),
      perfLogger.wrap('render.fetchData.distributions', () =>
        Promise.all([
          dataManager.getStatusDistribution(user, firstUploadDate),
          dataManager.getRatingDistribution(user, firstUploadDate), // Optimized with date range
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
            status,
            rating,
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
            status,
            rating,
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
      // SWR: return cached value now, revalidate in background. fresh fetch
      // uses forceRefresh=true so it bypasses the in-method cache and
      // overwrites piestats via saveStats.
      swrStats(
        dataManager,
        'top_posts_by_type',
        uploaderId,
        () => dataManager.getTopPostsByType(user, true),
        'render.fetchData.topPosts',
      ),
      swrStats(
        dataManager,
        'recent_popular_posts',
        uploaderId,
        () => dataManager.getRecentPopularPosts(user, true),
        'render.fetchData.recentPopular',
      ),
      swrStats(
        dataManager,
        `milestones_1000_${isNsfwEnabled ? '1' : '0'}`,
        uploaderId,
        () => dataManager.getMilestones(user, isNsfwEnabled, 1000, true),
        'render.fetchData.milestones1k',
      ),
      perfLogger.wrap('render.fetchData.scatterData', () =>
        dataManager.getScatterData(user),
      ),
      swrStats(
        dataManager,
        'level_change_history',
        uploaderId,
        () => dataManager.getLevelChangeHistory(user, true),
        'render.fetchData.levelChanges',
      ),
      perfLogger.wrap('render.fetchData.timelineMilestones', () =>
        dataManager.getTimelineMilestones(user),
      ),
      perfLogger.wrap('render.fetchData.tagCloudGeneral', () =>
        dataManager.getTagCloudData(user, 0),
      ),
      perfLogger.wrap('render.fetchData.userStats', () =>
        dataManager.getUserStats(user),
      ),
      perfLogger.wrap('render.fetchData.needsBackfill', () =>
        dataManager.needsPostMetadataBackfill(user),
      ),
    ]);

    return {
      stats,
      total,
      summaryStats,
      distributions,
      topPosts: topPostsSwr.data,
      topPostsRevalidate: topPostsSwr.revalidate,
      recentPopularPosts: recentPopularSwr.data,
      recentPopularRevalidate: recentPopularSwr.revalidate,
      randomPostsPromise,
      milestones1k: milestones1kSwr.data,
      milestones1kRevalidate: milestones1kSwr.revalidate,
      scatterData,
      levelChanges: levelChangesSwr.data,
      levelChangesRevalidate: levelChangesSwr.revalidate,
      timelineMilestones,
      tagCloudGeneral,
      userStats,
      needsBackfill,
      dataManager,
    };
  }
}
