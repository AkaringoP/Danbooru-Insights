import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {perfLogger} from '../core/perf-logger';
import {getCountCacheTtlMs, getNsfwEnabled} from '../core/settings';
import type {Database} from '../core/database';
import type {ProfileContext} from '../core/profile-context';
import type {RateLimitedFetch} from '../core/rate-limiter';
import {
  WINDOW_SIZE,
  newestPoints,
  scatterPointToWindowPoint,
} from '../core/profile-summary';
import type {
  DistributionItem,
  ProfileSummaryInput,
  ScatterDataPoint,
  TagCloudItem,
  TagShare,
  TargetUser,
  WindowPoint,
} from '../types';
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

/** Shared plumbing for one `fetchDashboardData` phase. */
interface PhaseContext {
  dataManager: AnalyticsDataManager;
  uploaderId: number;
  sub: (msg: string) => void;
  step: () => void;
}

/**
 * One SWR phase of the dashboard load: cached piestats value now, background
 * revalidate later (see {@link swrStats}), with the spinner sub-status set on
 * a real fetch and the phase tracker stepped when it settles. `maxAgeMs`
 * defaults to the count-cache TTL; pass `undefined` explicitly to force a
 * post-paint revalidate.
 */
function swrPhase<T>(
  ctx: PhaseContext,
  cacheKey: string,
  status: string,
  label: string,
  load: () => Promise<T>,
  ...ttl: [maxAgeMs?: number]
): Promise<SwrResult<T>> {
  const maxAgeMs = ttl.length ? ttl[0] : getCountCacheTtlMs();
  return swrStats(
    ctx.dataManager,
    cacheKey,
    ctx.uploaderId,
    () => {
      ctx.sub(status);
      return load();
    },
    `dbi:net:fetchData:${label}`,
    maxAgeMs,
  ).finally(ctx.step);
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
 * Heavy distributions fetched up front even on a cold cache: the pie opens on
 * copyright, and these three related-tag tabs are the ones users read most
 * and the ones that cost the most to fetch on a tab click. The other six
 * (gender, breasts, hair ×2, commentary, translation) are left out of the
 * blocking cold-cache load; the pie widget fetches a missing tab when it is
 * first opened (its "Loading..." path), and a tab never opened costs nothing.
 */
const EAGER_HEAVY_DISTS: ReadonlySet<HeavyDistKey> = new Set([
  'copyright',
  'character',
  'fav_copyright',
]);

/**
 * SWR-fetches the nine heavy tag distributions in parallel. Each returns its
 * cached value immediately (stale allowed); when the cache is older than the
 * count-cache TTL, `revalidators` carries a starter the caller runs post-paint.
 *
 * Cold cache (first open, or after a full reset): only `EAGER_HEAVY_DISTS`
 * block. A 46k-post account's first dashboard load used to fire ~250
 * requests here, all at once, on top of a 235-page sync — most of the
 * post-sync 429s came from this burst.
 *
 * These used to be force-refreshed on the blocking sync path (the old
 * `refreshAllStats`); moving them behind the same SWR machinery status/rating
 * already use is what keeps a post-sync open fast. A top-10 distribution
 * barely shifts when a few posts are added, so the previous sync's cache is
 * shown at once and freshened in the background — thumbnails live-patch via the
 * `DanbooruInsights:DataUpdated` event; slice proportions land on the next
 * open. Audit R2. On a genuine cache miss only the eager three block; the
 * rest wait for their tab.
 *
 * Exported for the eager/lazy split's regression tests.
 */
export async function fetchHeavyDistributionsSwr(
  dataManager: AnalyticsDataManager,
  user: TargetUser,
  uploaderId: number,
  sub: (msg: string) => void,
  forceRevalidate: boolean,
): Promise<{
  /** A lazy tab with no cache is absent: the pie loads it when opened. */
  distributions: Partial<Record<HeavyDistKey, DistributionItem[]>>;
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
    defs.map(async d => {
      if (!EAGER_HEAVY_DISTS.has(d.key) && uploaderId) {
        const cached = await dataManager.getStats(d.cacheKey, uploaderId);
        if (cached === null)
          return {data: undefined, startRevalidate: undefined};
      }
      return swrStats<DistributionItem[]>(
        dataManager,
        d.cacheKey,
        uploaderId,
        d.fetch,
        d.label,
        ttl,
      );
    }),
  );

  const distributions: Partial<Record<HeavyDistKey, DistributionItem[]>> = {};
  // Keyed by piestats cacheKey (contentType) so renderDashboard can dispatch
  // DanbooruInsights:DataUpdated with a key the pie widget's map understands.
  const revalidators: Array<
    [string, (() => Promise<DistributionItem[] | null>) | undefined]
  > = [];
  results.forEach((r, i) => {
    if (r.data !== undefined) distributions[defs[i].key] = r.data;
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
    const phase: PhaseContext = {
      dataManager,
      uploaderId,
      sub,
      step: () => tracker.step(),
    };

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
      swrPhase(phase, 'status_dist', 'Loading status counts…', 'status', () =>
        dataManager.getStatusDistribution(user, firstUploadDate, true),
      ),
      swrPhase(phase, 'rating_dist', 'Loading rating counts…', 'rating', () =>
        dataManager.getRatingDistribution(user, firstUploadDate, true),
      ),
      // SWR: return cached value now, revalidate in background. fresh fetch
      // uses forceRefresh=true so it bypasses the in-method cache and
      // overwrites piestats via saveStats. The count-cache TTL is now passed
      // so a sub-TTL cache hit skips the background revalidate entirely —
      // without it, `refreshCriticalStats` freshens these on sync and then the
      // post-paint revalidate re-fetches the very same data seconds later
      // (audit M-5). Matches the status/rating SWR calls above.
      swrPhase(
        phase,
        'top_posts_by_type',
        'Loading top posts by rating…',
        'topPosts',
        () => dataManager.getTopPostsByType(user, true),
      ),
      swrPhase(
        phase,
        'recent_popular_posts',
        'Loading recent popular posts…',
        'recentPopular',
        () => dataManager.getRecentPopularPosts(user, true),
      ),
      swrPhase(
        phase,
        `milestones_1000_${isNsfwEnabled ? '1' : '0'}`,
        'Loading milestones…',
        'milestones1k',
        () => dataManager.getMilestones(user, isNsfwEnabled, 1000, true),
      ),
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
      swrPhase(
        phase,
        'level_change_history',
        'Loading level change history…',
        'levelChanges',
        () => dataManager.getLevelChangeHistory(user, true),
      ),
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

    // The dashboard's "At a glance" card judges every synced upload — no
    // live window request on the dashboard path (that lives in the popover).
    const profileSummaryInput = await assembleProfileSummaryInput({
      dataManager,
      user,
      firstUploadDate,
      total,
      status: statusSwr.data,
      // Both are in EAGER_HEAVY_DISTS, so always present; `?? []` only
      // satisfies the Partial type.
      copyright: distributions.copyright ?? [],
      character: distributions.character ?? [],
      scatterData,
      recentWindow: [],
    });

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
      profileSummaryInput,
      dataManager,
    };
  }
}

/**
 * Builds the "At a glance" input. The lifetime baseline is every locally
 * synced upload: the scatter data when it was fetched (≥
 * SCATTER_MIN_UPLOADS), otherwise one local cursor pass — the scatter gate
 * exists because the widget is meaningless that small, not because the read
 * is expensive. Without a live window (dashboard, or a failed popover fetch)
 * the newest local uploads stand in for "recent".
 */
export async function assembleProfileSummaryInput(args: {
  dataManager: AnalyticsDataManager;
  user: TargetUser;
  firstUploadDate: Date | null;
  total: number;
  status: Array<{name: string; count: number}>;
  copyright: DistributionItem[];
  character: DistributionItem[];
  scatterData: ScatterDataPoint[];
  recentWindow: WindowPoint[];
}): Promise<ProfileSummaryInput> {
  const scatter = args.scatterData.length
    ? args.scatterData
    : await args.dataManager.getScatterData(args.user);
  const lifetimePoints = scatter.map(scatterPointToWindowPoint);
  const window = args.recentWindow.length
    ? args.recentWindow
    : newestPoints(lifetimePoints, WINDOW_SIZE);
  return {
    userName: args.user.name.replace(/ /g, '_'),
    firstUploadDate: args.firstUploadDate,
    total: args.total,
    lifetimeDeleted: deletedCount(args.status),
    lifetimeStatus: statusTriple(args.status),
    copyrightTop: topTagNames(args.copyright),
    characterTop: topTagNames(args.character),
    lifetimeFocus: {
      copyright: topTagShares(args.copyright),
      character: topTagShares(args.character),
    },
    lifetimePoints,
    window,
  };
}

/** Lifetime deleted uploads from the status distribution, if present. */
export function deletedCount(
  status: Array<{name: string; count: number}>,
): number | null {
  return status.find(s => s.name === 'deleted')?.count ?? null;
}

/** Lifetime pending / flagged / banned counts, when the status row exists. */
export function statusTriple(
  status: Array<{name: string; count: number}>,
): ProfileSummaryInput['lifetimeStatus'] {
  if (!status.length) return null;
  const get = (n: string) => status.find(s => s.name === n)?.count ?? 0;
  return {
    pending: get('pending'),
    flagged: get('flagged'),
    banned: get('banned'),
  };
}

/**
 * Popover ("mini report") input: the live newest-200 window (1 request,
 * piestats-cached with the count TTL) judged against whatever is already
 * local — synced posts and the cached status / copyright / character
 * distributions. No other network: a user who was never synced simply gets
 * the window's own health without lifetime comparisons.
 */
export async function buildRecentSummaryInput(
  dataManager: AnalyticsDataManager,
  user: TargetUser,
  total: number,
): Promise<ProfileSummaryInput> {
  const uploaderId = parseInt(user.id ?? '0');
  const cached = async <T>(key: string, fallback: T): Promise<T> =>
    uploaderId
      ? (((await dataManager.getStats(key, uploaderId)) as T | null) ??
        fallback)
      : fallback;
  const [recentWindow, scatterData, status, copyright, character] =
    await Promise.all([
      dataManager.getRecentUploadWindow(user, WINDOW_SIZE),
      dataManager.getScatterData(user),
      cached<Array<{name: string; count: number}>>('status_dist', []),
      cached<DistributionItem[]>('copyright_dist', []),
      cached<DistributionItem[]>('character_dist', []),
    ]);
  const firstTs = scatterData.length
    ? Math.min(...scatterData.map(p => p.d))
    : null;
  return assembleProfileSummaryInput({
    dataManager,
    user,
    firstUploadDate: firstTs === null ? null : new Date(firstTs),
    total,
    status,
    copyright,
    character,
    scatterData,
    recentWindow,
  });
}

/** Tag + count of a pie distribution's real slices, largest first. */
function topTagShares(items: DistributionItem[]): TagShare[] {
  return items
    .filter(i => !i.isOther && i.tagName)
    .map(i => ({tag: i.tagName as string, count: i.count}))
    .sort((a, b) => b.count - a.count);
}

/** Raw tag names of a pie distribution's real (non-"Others") slices. */
function topTagNames(items: DistributionItem[]): string[] {
  return items
    .filter(i => !i.isOther && i.tagName)
    .map(i => i.tagName as string);
}
