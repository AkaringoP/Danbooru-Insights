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

    const [
      stats,
      total,
      distributions,
      topPosts,
      recentPopularPosts,
      milestones1k,
      scatterData,
      levelChanges,
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
      perfLogger.wrap('render.fetchData.topPosts', () =>
        dataManager.getTopPostsByType(user),
      ),
      perfLogger.wrap('render.fetchData.recentPopular', () =>
        dataManager.getRecentPopularPosts(user),
      ),
      perfLogger.wrap('render.fetchData.milestones1k', () =>
        dataManager.getMilestones(user, isNsfwEnabled, 1000),
      ),
      perfLogger.wrap('render.fetchData.scatterData', () =>
        dataManager.getScatterData(user),
      ),
      perfLogger.wrap('render.fetchData.levelChanges', () =>
        dataManager.getLevelChangeHistory(user),
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
      topPosts,
      recentPopularPosts,
      randomPostsPromise,
      milestones1k,
      scatterData,
      levelChanges,
      timelineMilestones,
      tagCloudGeneral,
      userStats,
      needsBackfill,
      dataManager,
    };
  }
}
