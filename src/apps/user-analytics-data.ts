import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {perfLogger} from '../core/perf-logger';
import {getCountCacheTtlMs, getNsfwEnabled} from '../core/settings';
import type {Database} from '../core/database';
import type {ProfileContext} from '../core/profile-context';
import type {RateLimitedFetch} from '../core/rate-limiter';
import type {DistributionItem, TagCloudItem, TargetUser} from '../types';
import {createPhaseTracker, type ReportProgress} from './progress-tracker';
import {SCATTER_MIN_UPLOADS, TAG_CLOUD_MIN_UPLOADS} from './widget-gates';

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
interface SwrResult<T> {
  data: T;
  /** Kicks off the background fetch. Returns the original Promise for error
   *  handling; resolves with fresh data iff it differs from `data`. */
  startRevalidate?: () => Promise<T | null>;
}

/**
 * Reads cached data from piestats, prepares (but does not start) a
 * background fetch if found, and blocks only on cache miss.
 *
 * `maxAgeMs` (v9.6.0) — when provided, suppresses the background revalidate
 * if the cached record is younger than the threshold. Used for count-driven
 * caches (`status_dist`, `rating_dist`) so the SWR pathway honours the same
 * "Count Refresh (min)" TTL as the 9 tryGetCachedStats-based distributions.
 * Without it, every dashboard open fires a background API call regardless
 * of cache age — wasteful when nothing has changed since the last sync.
 *
 * Cache age and partial-sync trigger interact: a partial sync (via
 * performPartialSync → refreshAllStats with forceRefresh=true) overwrites
 * the cache with a fresh timestamp, so the next open finds age < TTL and
 * skips revalidate.
 */
export async function swrStats<T>(
  dataManager: AnalyticsDataManager,
  cacheKey: string,
  uploaderId: number,
  freshFetch: () => Promise<T>,
  label: string,
  maxAgeMs?: number,
): Promise<SwrResult<T>> {
  // No uploader id → skip cache entirely, same behaviour as before.
  if (!uploaderId) {
    const data = await perfLogger.wrap(label, freshFetch);
    return {data};
  }

  // Fresh cache path: cache exists AND is within the TTL window. Return
  // immediately, no revalidate. This is the new behaviour gating point.
  if (maxAgeMs !== undefined) {
    const fresh = (await dataManager.getStats(
      cacheKey,
      uploaderId,
      maxAgeMs,
    )) as T | null;
    if (fresh !== null) return {data: fresh};
  }

  // Stale-but-cached path (or no TTL gate): return cached value now,
  // schedule the revalidate for after paint.
  const cached = (await dataManager.getStats(cacheKey, uploaderId)) as T | null;

  if (cached !== null) {
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

/** The nine heavy tag-distribution keys as they appear on the dashboard
 *  `distributions` object. */
type HeavyDistKey =
  | 'character'
  | 'copyright'
  | 'fav_copyright'
  | 'breasts'
  | 'hair_length'
  | 'hair_color'
  | 'gender'
  | 'commentary'
  | 'translation';

/**
 * SWR-fetches the nine heavy tag distributions in parallel. Each returns its
 * cached value immediately (stale allowed); when the cache is older than the
 * count-cache TTL, `revalidators` carries a starter the caller runs post-paint.
 *
 * These used to be force-refreshed on the blocking sync path (the old
 * `refreshAllStats`); moving them behind the same SWR machinery status/rating
 * already use is what keeps a post-sync open fast. A top-10 distribution
 * barely shifts when a few posts are added, so the previous sync's cache is
 * shown at once and freshened in the background — thumbnails live-patch via the
 * `DanbooruInsights:DataUpdated` event; slice proportions land on the next
 * open. Audit R2. On a genuine cache miss (first-ever open) each fetch blocks,
 * which is the one-time unavoidable cost.
 */
async function fetchHeavyDistributionsSwr(
  dataManager: AnalyticsDataManager,
  user: TargetUser,
  uploaderId: number,
  sub: (msg: string) => void,
  forceRevalidate: boolean,
): Promise<{
  distributions: Record<HeavyDistKey, DistributionItem[]>;
  revalidators: Array<
    [string, (() => Promise<DistributionItem[] | null>) | undefined]
  >;
}> {
  // After a sync the per-tag counts may have moved (new uploads, deletions),
  // so force a post-paint revalidate regardless of the count-cache TTL — the
  // pie live-patch converges the shown counts to fresh within seconds without
  // a reopen. On a plain browse-open (no sync) we honour the TTL so repeated
  // opens don't re-run ~130 count fetches (audit R2 + M-5). Passing `undefined`
  // to swrStats skips its fresh-cache short-circuit → always returns a
  // revalidate starter.
  const ttl = forceRevalidate ? undefined : getCountCacheTtlMs();
  const defs: Array<{
    key: HeavyDistKey;
    cacheKey: string;
    label: string;
    fetch: () => Promise<DistributionItem[]>;
  }> = [
    {
      key: 'character',
      cacheKey: 'character_dist',
      label: 'dbi:net:fetchData:character',
      fetch: () => {
        sub('Loading character distribution…');
        return dataManager.getCharacterDistribution(user, true, sub);
      },
    },
    {
      key: 'copyright',
      cacheKey: 'copyright_dist',
      label: 'dbi:net:fetchData:copyright',
      fetch: () => {
        sub('Loading copyright distribution…');
        return dataManager.getCopyrightDistribution(user, true, sub);
      },
    },
    {
      key: 'fav_copyright',
      cacheKey: 'fav_copyright_dist',
      label: 'dbi:net:fetchData:favCopyright',
      fetch: () => {
        sub('Loading favourite-copyright distribution…');
        return dataManager.getFavCopyrightDistribution(user, true, sub);
      },
    },
    {
      key: 'breasts',
      cacheKey: 'breasts_dist',
      label: 'dbi:net:fetchData:breasts',
      fetch: () => {
        sub('Loading breast-size distribution…');
        return dataManager.getBreastsDistribution(user, true, sub);
      },
    },
    {
      key: 'hair_length',
      cacheKey: 'hair_length_dist',
      label: 'dbi:net:fetchData:hairLength',
      fetch: () => {
        sub('Loading hair-length distribution…');
        return dataManager.getHairLengthDistribution(user, true, sub);
      },
    },
    {
      key: 'hair_color',
      cacheKey: 'hair_color_dist',
      label: 'dbi:net:fetchData:hairColor',
      fetch: () => {
        sub('Loading hair-color distribution…');
        return dataManager.getHairColorDistribution(user, true, sub);
      },
    },
    {
      key: 'gender',
      cacheKey: 'gender_dist',
      label: 'dbi:net:fetchData:gender',
      fetch: () => {
        sub('Loading gender distribution…');
        return dataManager.getGenderDistribution(user, true, sub);
      },
    },
    {
      key: 'commentary',
      cacheKey: 'commentary_dist',
      label: 'dbi:net:fetchData:commentary',
      fetch: () => {
        sub('Loading commentary distribution…');
        return dataManager.getCommentaryDistribution(user, true, sub);
      },
    },
    {
      key: 'translation',
      cacheKey: 'translation_dist',
      label: 'dbi:net:fetchData:translation',
      fetch: () => {
        sub('Loading translation distribution…');
        return dataManager.getTranslationDistribution(user, true, sub);
      },
    },
  ];

  const results = await Promise.all(
    defs.map(d =>
      swrStats<DistributionItem[]>(
        dataManager,
        d.cacheKey,
        uploaderId,
        d.fetch,
        d.label,
        ttl,
      ),
    ),
  );

  const distributions = {} as Record<HeavyDistKey, DistributionItem[]>;
  // Keyed by piestats cacheKey (contentType) so renderDashboard can dispatch
  // DanbooruInsights:DataUpdated with a key the pie widget's map understands.
  const revalidators: Array<
    [string, (() => Promise<DistributionItem[] | null>) | undefined]
  > = [];
  results.forEach((r, i) => {
    distributions[defs[i].key] = r.data;
    revalidators.push([defs[i].cacheKey, r.startRevalidate]);
  });
  return {distributions, revalidators};
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
      /**
       * Sub-tag breakdown for legend hover/tap (Copy / Fav_Copy / Char,
       * v9.6.0+). Source: `DistributionItem.subTags` from the resolver.
       */
      subTags?: import('../types').SubTagBreakdownEntry[];
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
  private readonly rateLimiter: RateLimitedFetch | null;

  /**
   * @param db The Dexie database instance.
   * @param rateLimiter The app's shared rate limiter. Passing it keeps the
   *   dashboard fetch (and the now-heavier post-paint SWR revalidate flood)
   *   on the TabCoordinator-managed, 429-backoff-aware limiter instead of a
   *   private bucket that would blow past Danbooru's server cap (audit H-1).
   *   Optional so existing callers/tests that only need cache reads still work.
   */
  constructor(db: Database, rateLimiter: RateLimitedFetch | null = null) {
    this.db = db;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Fetches all dashboard data in parallel.
   * @param context The profile context.
   * @param prefetched Optional results from renderDashboard's pre-check phase.
   *   When provided, syncStats/totalCount are reused instead of re-fetched
   *   (saves one DB scan + one API call, ~400-900ms depending on user size).
   * @param onProgress Optional progress sink. Called as phases enter and
   *   as their data-layer reportSubStatus emitters fire. Wired by
   *   `renderDashboard` to update the loading spinner text live.
   * @return All data needed for the dashboard.
   */
  // Fits within the 200-LOC budget since the nine heavy distributions were
  // hoisted into `fetchHeavyDistributionsSwr` (SWR conversion, audit R2).
  //
  // `forceDistRevalidate` — set by renderDashboard when a sync just ran, so the
  // deferred distributions revalidate post-paint regardless of TTL and their
  // per-tag counts converge to fresh (the pie live-patches them in place).
  async fetchDashboardData(
    context: ProfileContext,
    prefetched?: PrefetchedDashboardData,
    onProgress?: ReportProgress,
    forceDistRevalidate = false,
  ) {
    const dataManager = new AnalyticsDataManager(this.db, this.rateLimiter);
    // context.targetUser is guaranteed non-null when called from UserAnalyticsApp
    // (main.ts validates via isValidProfile() before instantiation).

    const user = context.targetUser!;

    // NSFW State for milestones
    const isNsfwEnabled = getNsfwEnabled();

    // Progress reporter (no-op when caller did not wire onProgress).
    const progress = onProgress ?? (() => {});
    // 14 parallel top-level tasks below (counted manually to match the
    // Promise.all shape). The label flickers between this tracker's
    // counter and the distribution-method substatus strings — that's
    // intentional, last-wins gives the user a sense of multiple things
    // in flight without needing nested counters.
    const tracker = createPhaseTracker('Loading dashboard', 14, progress);
    const sub = tracker.subStatus;

    // 1. Fetch Summary Stats first (Local DB) to get starting date for optimizations
    sub('Loading summary stats…');
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
      distributionsSwr,
      statusSwr,
      ratingSwr,
      topPostsSwr,
      recentPopularSwr,
      milestones1kSwr,
      scatterData,
      levelChangesSwr,
      timelineMilestones,
      tagCloudGeneralSwr,
      userStats,
      needsBackfill,
    ] = await Promise.all([
      (prefetched
        ? Promise.resolve(prefetched.syncStats)
        : perfLogger.wrap('dbi:net:fetchData:syncStats', () => {
            sub('Loading sync stats…');
            return dataManager.getSyncStats(user);
          })
      ).finally(() => tracker.step()),
      (prefetched
        ? Promise.resolve(prefetched.totalCount)
        : perfLogger.wrap('dbi:net:fetchData:totalCount', () => {
            sub('Loading total post count…');
            return dataManager.getTotalPostCount(user);
          })
      ).finally(() => tracker.step()),
      // The nine heavy tag distributions — SWR (stale cache now, background
      // revalidate post-paint). Moved off the blocking sync path so a
      // post-sync open stays fast; see fetchHeavyDistributionsSwr. `sub` is
      // passed through so a genuine cache-miss (first-ever open) still reports
      // per-tag count fetches in the spinner detail line.
      fetchHeavyDistributionsSwr(
        dataManager,
        user,
        uploaderId,
        sub,
        forceDistRevalidate,
      ).finally(() => tracker.step()),
      // Status + Rating previously fired 10 API calls on every open
      // (6 status + 4 rating). SWR-cached; v9.6.0 also passes the count
      // cache TTL so a sub-TTL cache hit skips the background revalidate
      // entirely — matches the 9 other count-driven distributions and
      // honours the "Count Refresh (min)" setting consistently.
      swrStats(
        dataManager,
        'status_dist',
        uploaderId,
        () => {
          sub('Loading status counts…');
          return dataManager.getStatusDistribution(user, firstUploadDate, true);
        },
        'dbi:net:fetchData:status',
        getCountCacheTtlMs(),
      ).finally(() => tracker.step()),
      swrStats(
        dataManager,
        'rating_dist',
        uploaderId,
        () => {
          sub('Loading rating counts…');
          return dataManager.getRatingDistribution(user, firstUploadDate, true);
        },
        'dbi:net:fetchData:rating',
        getCountCacheTtlMs(),
      ).finally(() => tracker.step()),
      // SWR: return cached value now, revalidate in background. fresh fetch
      // uses forceRefresh=true so it bypasses the in-method cache and
      // overwrites piestats via saveStats. The count-cache TTL is now passed
      // so a sub-TTL cache hit skips the background revalidate entirely —
      // without it, `refreshCriticalStats` freshens these on sync and then the
      // post-paint revalidate re-fetches the very same data seconds later
      // (audit M-5). Matches the status/rating SWR calls above.
      swrStats(
        dataManager,
        'top_posts_by_type',
        uploaderId,
        () => {
          sub('Loading top posts by rating…');
          return dataManager.getTopPostsByType(user, true);
        },
        'dbi:net:fetchData:topPosts',
        getCountCacheTtlMs(),
      ).finally(() => tracker.step()),
      swrStats(
        dataManager,
        'recent_popular_posts',
        uploaderId,
        () => {
          sub('Loading recent popular posts…');
          return dataManager.getRecentPopularPosts(user, true);
        },
        'dbi:net:fetchData:recentPopular',
        getCountCacheTtlMs(),
      ).finally(() => tracker.step()),
      swrStats(
        dataManager,
        `milestones_1000_${isNsfwEnabled ? '1' : '0'}`,
        uploaderId,
        () => {
          sub('Loading milestones…');
          return dataManager.getMilestones(user, isNsfwEnabled, 1000, true);
        },
        'dbi:net:fetchData:milestones1k',
        getCountCacheTtlMs(),
      ).finally(() => tracker.step()),
      // Skip the scatter fetch entirely when the upload-count gate
      // (v9.6.0) will hide the widget anyway — the placeholder doesn't
      // need scatter data.
      (prefetched && prefetched.totalCount < SCATTER_MIN_UPLOADS
        ? Promise.resolve([])
        : perfLogger.wrap('dbi:net:fetchData:scatterData', () => {
            sub('Loading scatter data…');
            return dataManager.getScatterData(user);
          })
      ).finally(() => tracker.step()),
      swrStats(
        dataManager,
        'level_change_history',
        uploaderId,
        () => {
          sub('Loading level change history…');
          return dataManager.getLevelChangeHistory(user, true);
        },
        'dbi:net:fetchData:levelChanges',
        getCountCacheTtlMs(),
      ).finally(() => tracker.step()),
      perfLogger
        .wrap('dbi:net:fetchData:timelineMilestones', () => {
          sub('Loading timeline milestones…');
          return dataManager.getTimelineMilestones(user);
        })
        .finally(() => tracker.step()),
      // Skip the tag-cloud fetch entirely when the upload-count gate
      // (v9.6.0) will hide the widget anyway. Otherwise SWR: stale cache now,
      // background revalidate post-paint (same as the heavy distributions).
      (prefetched && prefetched.totalCount < TAG_CLOUD_MIN_UPLOADS
        ? Promise.resolve({data: [] as TagCloudItem[]} as SwrResult<
            TagCloudItem[]
          >)
        : swrStats(
            dataManager,
            'tag_cloud_general',
            uploaderId,
            () => {
              sub('Loading tag cloud…');
              return dataManager.getTagCloudData(user, 0, true);
            },
            'dbi:net:fetchData:tagCloudGeneral',
            getCountCacheTtlMs(),
          )
      ).finally(() => tracker.step()),
      perfLogger
        .wrap('dbi:net:fetchData:userStats', () => {
          sub('Loading user stats…');
          return dataManager.getUserStats(user);
        })
        .finally(() => tracker.step()),
      perfLogger
        .wrap('dbi:net:fetchData:needsBackfill', () => {
          sub('Checking post metadata backfill…');
          return dataManager.needsPostMetadataBackfill(user);
        })
        .finally(() => tracker.step()),
    ]);

    // All 14 phases settled — mark the tracker fully done so the
    // headline reads "Loading dashboard · 14/14" right before the
    // dashboard widgets replace the spinner DOM.
    tracker.finish();

    // Recombine status + rating (SWR'd) with the nine heavy distributions
    // (now SWR'd too — stale cache shown, revalidated post-paint).
    const distributions = {
      status: statusSwr.data,
      rating: ratingSwr.data,
      ...distributionsSwr.distributions,
    };

    return {
      stats,
      total,
      summaryStats,
      distributions,
      statusStartRevalidate: statusSwr.startRevalidate,
      ratingStartRevalidate: ratingSwr.startRevalidate,
      // Background revalidators for the nine heavy distributions, keyed by
      // piestats cacheKey. renderDashboard fires these post-paint via
      // schedulePieRevalidate; when one returns fresh (changed) data it
      // dispatches DanbooruInsights:DataUpdated so the open pie live-patches
      // that tab's proportions/counts/thumbs in place — no reopen needed.
      distributionRevalidators: distributionsSwr.revalidators,
      tagCloudGeneralStartRevalidate: tagCloudGeneralSwr.startRevalidate,
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
      tagCloudGeneral: tagCloudGeneralSwr.data,
      userStats,
      needsBackfill,
      dataManager,
    };
  }
}
