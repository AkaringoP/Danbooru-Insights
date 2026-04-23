import * as d3 from 'd3';
import {CONFIG} from '../config';
import {applyDashboardTheme, resolveEffectiveDashboardTheme} from '../main';
import {RateLimitedFetch} from '../core/rate-limiter';
import {createLogger} from '../core/logger';
import {escapeHtml, getBestThumbnailUrl} from '../utils';
import type {Database} from '../core/database';
import type {SettingsManager} from '../core/settings';
import {TagAnalyticsDataService} from './tag-analytics-data';
import type {
  InitialStats,
  LocalStats,
  RankingResult,
} from './tag-analytics-data';
import {TagAnalyticsChartRenderer} from './tag-analytics-charts';
import {dashboardFooterHtml} from '../ui/dashboard-footer';
import {showToast} from '../ui/toast';
import type {
  TagAnalyticsMeta,
  DanbooruPost,
  UserRanking,
  HistoryEntry,
  MilestoneEntry,
} from '../types';

const log = createLogger('TagAnalytics');

/** fetchMonthlyCounts attaches historyCutoff to the returned array object. */
type MonthlyHistoryData = HistoryEntry[] & {historyCutoff?: string};

/** Result from _checkCache(). null = served from cache (caller should return). */
interface CacheCheckResult {
  runDelta: boolean;
  baseData: TagAnalyticsMeta | null;
}

/** Quick stats fetched in Phase 1 of the large-tag path. */
interface QuickStatsResult {
  statusCounts: Record<string, number>;
  latestPost: DanbooruPost | null;
  newPostCount: number;
  trendingPost: DanbooruPost | null;
  trendingPostNSFW: DanbooruPost | null;
  copyrightCounts: Record<string, number> | null;
  characterCounts: Record<string, number> | null;
  commentaryCounts: Record<string, number>;
}

/** Promise bundle built by _buildHeavyStatPromises(). */
interface HeavyStatPromises {
  historyPromise: Promise<HistoryEntry[]>;
  milestonesPromise: Promise<MilestoneEntry[]>;
  first100StatsPromise: Promise<LocalStats | undefined>;
}

/** Mutable container for backward-scan first-100 stats override. */
interface First100Override {
  value: LocalStats | null;
}

export class TagAnalyticsApp {
  db: Database;
  settings: SettingsManager;
  tagName: string;
  rateLimiter: RateLimitedFetch;
  dataService: TagAnalyticsDataService;
  isFetching: boolean;
  chartRenderer: TagAnalyticsChartRenderer;

  /**
   * Initializes the TagAnalyticsApp.
   * @param {!Database} db The Dexie database instance.
   * @param {!SettingsManager} settings The settings manager instance.
   * @param {string} tagName The name of the tag to analyze.
   */
  constructor(
    db: Database,
    settings: SettingsManager,
    tagName: string,
    rateLimiter?: RateLimitedFetch,
  ) {
    this.db = db;
    this.settings = settings;
    this.tagName = tagName;
    const rl = CONFIG.RATE_LIMITER;
    this.rateLimiter =
      rateLimiter ?? new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
    this.dataService = new TagAnalyticsDataService(
      db,
      this.rateLimiter,
      tagName,
    );
    this.chartRenderer = new TagAnalyticsChartRenderer();
    this.isFetching = false;
  }

  /**
   * Main execution method for Tag Analytics.
   * Orchestrates the entire process of data fetching, caching, and UI rendering.
   *
   * Flow:
   * 1. Checks and cleans up old cache (retention policy).
   * 2. Loads data from IndexedDB cache.
   * 3. Determines if a Partial Sync is needed based on:
   *    - Time elapsed since last update (> 24h).
   *    - Significant increase in post count.
   * 4. If Sync is needed or Cache is missing:
   *    - Fetches initial stats (first 100 posts, metadata).
   *    - handling for small tags (<= 100 posts) vs large tags.
   *    - Parallel fetching of volatile data (status, trending, etc.).
   *    - History backfilling for large tags.
   * 5. Updates the UI and saves the fresh data to cache.
   *
   * @return {Promise<void>} Resolves when the analytics process is complete.
   */
  async run(): Promise<void> {
    if (!this.tagName) return;

    // Early validation: check if this is a real tag with a valid category.
    // Wiki pages like "help:home" are not Danbooru tags and should be silently ignored.
    try {
      const tagData = await this.dataService.fetchTagData(this.tagName);
      const validCategories = [1, 3, 4]; // 1=Artist, 3=Copyright, 4=Character
      if (!tagData || !validCategories.includes(tagData.category)) {
        return;
      }
    } catch {
      return; // On network error, silently skip
    }

    // Only inject the button in idle state — no data fetching until user clicks
    this.injectAnalyticsButton(null);

    // Show sync status from cache (IndexedDB read only, no API calls)
    // Read raw DB entry directly to distinguish "no cache" vs "stale cache",
    // since loadFromCache() returns null for both cases when expired.
    try {
      const rawCache =
        this.db && this.db.tag_analytics
          ? await this.db.tag_analytics.get(this.tagName)
          : null;
      const statusLabel = document.getElementById('tag-analytics-status');
      if (!statusLabel) return;

      if (rawCache) {
        const age = Date.now() - rawCache.updatedAt;
        const isStale = age >= CONFIG.CACHE_EXPIRY_MS;
        const date = new Date(rawCache.updatedAt).toLocaleDateString();

        if (isStale) {
          statusLabel.textContent = `Updated: ${date} · Sync needed`;
          statusLabel.style.color = '#d73a49';
        } else {
          statusLabel.textContent = `Updated: ${date}`;
          statusLabel.style.color = '#28a745';
        }
      } else {
        statusLabel.textContent = 'Sync needed';
        statusLabel.style.color = '#d73a49';
      }
      statusLabel.style.display = 'inline';
    } catch {
      // Status display is non-critical, ignore errors
    }
  }

  /**
   * Updates the status label to show the last updated date in green.
   * Called after a successful fetch to restore the label hidden by injectAnalyticsButton.
   * @param {number} updatedAt - Timestamp of the update.
   */
  _showUpdatedStatus(updatedAt: number): void {
    const statusLabel = document.getElementById('tag-analytics-status');
    if (!statusLabel) return;
    const date = new Date(updatedAt).toLocaleDateString();
    statusLabel.textContent = `Updated: ${date}`;
    statusLabel.style.color = '#28a745';
    statusLabel.style.display = 'inline';
  }

  /**
   * Performs the full data fetch and renders the modal when complete.
   * Triggered by the user clicking the analytics button.
   *
   * Orchestrator — delegates to:
   *   _checkCache()  → cache-first path (volatile update + early render)
   *   _fetchSmallTag() → small tag (≤1200 posts) local computation
   *   _fetchLargeTag() → large tag multi-phase parallel fetch
   */
  async _fetchAndRender(): Promise<void> {
    const tagName = this.tagName;
    if (!tagName || this.isFetching) return;

    this.isFetching = true;

    try {
      this.injectAnalyticsButton(null, 0, 'Waiting...');
      void this.dataService.cleanupOldCache();

      // 1. Cache check — may serve from cache and return null
      const cacheResult = await this._checkCache();
      if (!cacheResult) return;
      const {runDelta, baseData} = cacheResult;

      // 2. Fetch initial stats + validate category
      const t0 = performance.now();
      this.rateLimiter.requestCounter = 0;
      const initialStats = await this.dataService.fetchInitialStats(
        tagName,
        baseData,
      );
      if (!initialStats || initialStats.totalCount === 0) {
        log.warn(`Could not fetch initial stats for tag: "${tagName}"`);
        return;
      }

      const {totalCount, startDate, initialPosts} = initialStats;
      const meta = initialStats.meta as unknown as TagAnalyticsMeta;
      meta.updatedAt = Date.now();

      // Validate category (1=Artist, 3=Copyright, 4=Character)
      if (![1, 3, 4].includes(meta.category)) {
        const btn = document.getElementById('tag-analytics-btn');
        if (btn) btn.remove();
        const status = document.getElementById('tag-analytics-status');
        if (status) status.remove();
        return;
      }
      this.injectAnalyticsButton(meta);

      // 3. Route to small-tag or large-tag path
      const isSmallTag =
        initialPosts &&
        totalCount <= CONFIG.MAX_OPTIMIZED_POSTS &&
        initialPosts.length >= totalCount;

      if (isSmallTag) {
        await this._fetchSmallTag(meta, initialStats, initialPosts, t0);
      } else {
        await this._fetchLargeTag(
          meta,
          initialStats,
          runDelta,
          baseData,
          startDate,
          initialPosts,
        );
      }
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Cache-first path: load cache, update volatile data if fresh, render.
   * @returns null if served from cache (caller should return), otherwise delta info.
   */
  private async _checkCache(): Promise<CacheCheckResult | null> {
    const tagName = this.tagName;
    const cachedData = await this.dataService.loadFromCache();

    if (!cachedData) {
      return {runDelta: false, baseData: null};
    }

    const age = Date.now() - cachedData.updatedAt;
    const isTimeExpired = age >= CONFIG.CACHE_EXPIRY_MS;

    let postCountDiff = 0;
    try {
      const currentTagData = await this.dataService.fetchTagData(tagName);
      if (currentTagData) {
        postCountDiff = Math.max(
          0,
          currentTagData.post_count - (cachedData.post_count || 0),
        );
      }
    } catch (e) {
      log.warn('Failed to check post count diff', {error: e});
    }

    const threshold = this.dataService.getSyncThreshold();
    const isCountThresholdMet = postCountDiff >= threshold;

    if (isTimeExpired || isCountThresholdMet) {
      log.debug(
        `Partial Sync Triggered. TimeExpired=${isTimeExpired} (${(age / 3600000).toFixed(1)}h), CountThreshold=${isCountThresholdMet} (${postCountDiff} >= ${threshold})`,
      );
      return {runDelta: true, baseData: cachedData};
    }

    // Cache is fresh — update volatile data and render
    cachedData._isCached = true;
    try {
      const newPostCount24h = await this.dataService.fetchNewPostCount(tagName);
      const [latestPost, trendingPost, trendingPostNSFW] = await Promise.all([
        this.dataService.fetchLatestPost(tagName),
        this.dataService.fetchTrendingPost(tagName, false),
        this.dataService.fetchTrendingPost(tagName, true),
      ]);
      cachedData.latestPost = latestPost ?? undefined;
      cachedData.trendingPost = trendingPost ?? undefined;
      cachedData.trendingPostNSFW = trendingPostNSFW ?? undefined;
      cachedData.newPostCount = newPostCount24h;
      await this.dataService.saveToCache(cachedData);
    } catch (e) {
      log.warn('Failed to update volatile data for cache:', {error: e});
    }

    this.injectAnalyticsButton(cachedData);
    this._showUpdatedStatus(cachedData.updatedAt);
    this.toggleModal(true);
    this.renderDashboard(cachedData);
    return null; // Served from cache
  }

  /**
   * Small tag path (≤1200 posts): compute history, rankings, and distribution locally.
   */
  private async _fetchSmallTag(
    meta: TagAnalyticsMeta,
    initialStats: InitialStats,
    initialPosts: DanbooruPost[],
    t0: number,
  ): Promise<void> {
    const tagName = this.tagName;
    const {firstPost, hundredthPost, timeToHundred, totalCount} = initialStats;

    this.injectAnalyticsButton(null, 0, 'Calculating history... (0%)');

    // Calculate History Locally
    const historyData =
      this.dataService.calculateHistoryFromPosts(initialPosts);

    // Extract Milestones Locally
    const targets = this.dataService.getMilestoneTargets(totalCount);
    const milestones: MilestoneEntry[] = [];
    targets.forEach(target => {
      const index = target - 1;
      if (initialPosts[index]) {
        milestones.push({
          milestone: target,
          post: initialPosts[index],
        } as MilestoneEntry);
      }
    });

    // Calculate Ratings & Rankings Locally
    this.injectAnalyticsButton(null, 15, 'Calculating rankings... (15%)');
    const localStatsAllTime =
      this.dataService.calculateLocalStats(initialPosts);

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const yearPosts = initialPosts.filter(
      (p: DanbooruPost) => p.created_at && new Date(p.created_at) >= oneYearAgo,
    );
    const localStatsYear = this.dataService.calculateLocalStats(yearPosts);
    const localStatsFirst100 = this.dataService.calculateLocalStats(
      initialPosts.slice(0, 100),
    );

    // Parallel Data Fetching (Volatile & Status)
    this.injectAnalyticsButton(null, 25, 'Fetching stats... (25%)');
    let smallTagFetched = 0;
    const smallTagTotalFetches = 6;
    const trackSmall = <T>(label: string, promise: Promise<T>): Promise<T> =>
      promise.then((res: T) => {
        smallTagFetched++;
        const pct =
          25 + Math.round((smallTagFetched / smallTagTotalFetches) * 55);
        this.injectAnalyticsButton(null, pct, `${label}... (${pct}%)`);
        return res;
      });

    const [
      statusCounts,
      latestPost,
      trendingPost,
      trendingPostNSFW,
      newPostCount,
      commentaryCounts,
    ] = await Promise.all([
      trackSmall(
        'Fetching status',
        this.dataService.fetchStatusCounts(tagName),
      ),
      trackSmall(
        'Fetching latest post',
        this.dataService.fetchLatestPost(tagName),
      ),
      trackSmall(
        'Finding trending post',
        this.dataService.fetchTrendingPost(tagName, false),
      ),
      trackSmall(
        'Finding trending NSFW',
        this.dataService.fetchTrendingPost(tagName, true),
      ),
      trackSmall(
        'Counting new posts',
        this.dataService.fetchNewPostCount(tagName),
      ),
      trackSmall(
        'Analyzing commentary',
        this.dataService.fetchCommentaryCounts(tagName),
      ),
      this.dataService.backfillUploaderNames(initialPosts),
    ]);

    // Attach Data
    meta.historyData = historyData;
    meta.firstPost = firstPost ?? undefined;
    meta.hundredthPost = hundredthPost ?? undefined;
    meta.timeToHundred = timeToHundred ?? undefined;
    meta.statusCounts = statusCounts;
    meta.commentaryCounts = commentaryCounts;
    meta.ratingCounts = localStatsAllTime.ratingCounts;
    meta.precalculatedMilestones = milestones;
    meta.latestPost = latestPost ?? undefined;
    meta.newPostCount = newPostCount;
    meta.trendingPost = trendingPost ?? undefined;
    meta.trendingPostNSFW = trendingPostNSFW ?? undefined;

    // Map User IDs to Names in Local Rankings
    const mapNames = (ranking: UserRanking[]) =>
      ranking.map((r: UserRanking) => {
        const u = this.dataService.userNames[r.id];
        return {
          ...r,
          name: (u ? u.name : null) || `user_${r.id}`,
          level: u ? u.level : null,
        };
      });

    meta.rankings = {
      uploader: {
        allTime: mapNames(localStatsAllTime.uploaderRanking),
        year: mapNames(localStatsYear.uploaderRanking),
        first100: mapNames(localStatsFirst100.uploaderRanking),
      },
      approver: {
        allTime: mapNames(localStatsAllTime.approverRanking),
        year: mapNames(localStatsYear.approverRanking),
        first100: mapNames(localStatsFirst100.approverRanking),
      },
    };

    // Calculate Related Tag Distribution Locally
    this.injectAnalyticsButton(null, 85, 'Analyzing tag distribution... (85%)');
    await this._calculateLocalTagDistribution(initialPosts, meta);

    this.injectAnalyticsButton(meta, 100, '');
    this._showUpdatedStatus(meta.updatedAt);
    await this.dataService.saveToCache(meta);

    log.debug(
      `[Small Tag Optimization] Finished analysis for tag: ${tagName} (Category: ${meta.category}, Count: ${totalCount}) in ${(performance.now() - t0).toFixed(2)}ms`,
    );

    this.toggleModal(true);
    this.renderDashboard(meta);
  }

  /**
   * Calculates copyright/character tag distribution locally from post data.
   * Used by the small-tag path where all posts are already in memory.
   */
  private async _calculateLocalTagDistribution(
    posts: DanbooruPost[],
    meta: TagAnalyticsMeta,
  ): Promise<void> {
    if (meta.category !== 1 && meta.category !== 3) return;

    const copyrightMap: Record<string, number> = {};
    const characterMap: Record<string, number> = {};

    posts.forEach((p: DanbooruPost) => {
      if (p.tag_string_copyright) {
        p.tag_string_copyright.split(' ').forEach((tag: string) => {
          if (tag) copyrightMap[tag] = (copyrightMap[tag] || 0) + 1;
        });
      }
      if (p.tag_string_character) {
        p.tag_string_character.split(' ').forEach((tag: string) => {
          if (tag) characterMap[tag] = (characterMap[tag] || 0) + 1;
        });
      }
    });

    if (meta.category === 1) {
      const copyrightCandidates = Object.entries(copyrightMap)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 20);

      // Batched tag_implications lookup via dataService — shares the
      // session + 180d persistent cache with fetchRelatedTagDistribution.
      const flags = await this.dataService.getTopLevelFlags(
        copyrightCandidates.map(([tag]) => tag),
      );
      const filteredCopyright = copyrightCandidates.filter(
        ([tag]) => flags.get(tag) === true,
      );

      const copyrightMap2: Record<string, number> = {};
      filteredCopyright.slice(0, 10).forEach(([name, count]) => {
        copyrightMap2[name] = count;
      });
      meta.copyrightCounts = copyrightMap2;
    }

    const characterMap2: Record<string, number> = {};
    Object.entries(characterMap)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 10)
      .forEach(([name, count]) => {
        characterMap2[name] = count;
      });
    meta.characterCounts = characterMap2;
  }

  /**
   * Re-renders the pie chart if its currently-active tab matches `type`.
   * Used by the related-tag SWR swap to replace approximate counts with
   * the exact values once the background `/counts/posts.json` batch
   * completes. No-ops when the user has navigated to a different tab —
   * the updated `meta` will be consumed on their next tab switch.
   */
  private _rerenderPieIfActive(
    meta: TagAnalyticsMeta,
    type: 'copyright' | 'character',
  ): void {
    const activeTab = document.querySelector('.di-pie-tab.active');
    if (activeTab?.getAttribute('data-type') === type) {
      this.chartRenderer.renderPieChart(type, meta);
    }
  }

  /**
   * Large tag path: multi-phase parallel fetch (quick stats → heavy stats → deferred counts).
   */
  private async _fetchLargeTag(
    meta: TagAnalyticsMeta,
    initialStats: InitialStats,
    runDelta: boolean,
    baseData: TagAnalyticsMeta | null,
    startDate: Date | undefined,
    initialPosts: DanbooruPost[] | null | undefined,
  ): Promise<void> {
    const tagName = this.tagName;
    const {totalCount} = initialStats;
    let {firstPost, hundredthPost} = initialStats;

    // Date range helpers
    const now = new Date();
    const oneYearAgoDate = new Date(now);
    oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr1Y = oneYearAgoDate.toISOString().split('T')[0];
    const dateStrTomorrow = tomorrow.toISOString().split('T')[0];

    // Timing + logging helper
    const measure = <T>(label: string, promise: Promise<T>): Promise<T> => {
      const start = performance.now();
      return promise.then((res: T) => {
        log.debug(
          `[Task] Finished: ${label} (${(performance.now() - start).toFixed(2)}ms)`,
        );
        return res;
      });
    };

    // Progress tracker (Phase 1: 8 tasks, Phase 2: 4 tasks = 12 total)
    let completedCount = 0;
    const totalEstimatedTasks = 12;
    this.injectAnalyticsButton(null, 0, 'Initializing...');

    const trackProgress = <T>(task: {
      id: string;
      label: string;
      promise: Promise<T>;
    }): Promise<T> => {
      return task.promise.then((res: T) => {
        completedCount++;
        const pct = Math.round((completedCount / totalEstimatedTasks) * 100);
        this.injectAnalyticsButton(null, pct, `${task.label} ${pct}%`);
        return res;
      });
    };

    // --- Kick off Phase 1 + Phase 2 in parallel ---
    // Both phases depend only on `initialStats` / `meta` (already in scope),
    // so Phase 2 promises start fetching the moment they are created, no
    // longer blocked behind Phase 1's await. Phase 3 waits on Phase 2's
    // historyData for its `minDate` anchor, so it stays sequential.
    const tTotal = performance.now();
    log.debug(
      `Starting analysis for tag: ${tagName} (Category: ${meta.category}, Count: ${totalCount})`,
    );

    // Phase 1 start
    const tGroup1Start = performance.now();
    const quickStatsPromise = this._runQuickStatsPhase(
      tagName,
      meta,
      totalCount,
      measure,
      trackProgress,
    );

    // Phase 2 start (concurrent with Phase 1)
    log.debug('[Phase 2] Starting Rankings & History in parallel...');

    // Ranking SWR: on revisit with cached rankings (delta sync path), the
    // 4× fetchReportRanking calls (12s under the report-queue 3s cooldown)
    // are moved off the critical path. `rankingPromise` resolves
    // immediately with the cached report; the real network fetch runs via
    // `rankingRevalidatePromise` and its result is applied after the
    // dashboard is painted.
    const canSwrRankings = Boolean(
      runDelta &&
      baseData?.rankings?.uploader?.allTime &&
      baseData?.rankings?.approver?.allTime,
    );
    let rankingPromise: Promise<RankingResult>;
    let rankingRevalidatePromise: Promise<RankingResult> | null = null;
    if (canSwrRankings && baseData?.rankings) {
      const cached = baseData.rankings;
      rankingPromise = Promise.resolve({
        uploaderAll: cached.uploader.allTime,
        approverAll: cached.approver.allTime,
        uploaderYear: cached.uploader.year,
        approverYear: cached.approver.year,
      });
      rankingRevalidatePromise = this.dataService.fetchRankingsAndResolve(
        tagName,
        dateStr1Y,
        dateStrTomorrow,
        measure,
      );
    } else {
      rankingPromise = this.dataService.fetchRankingsAndResolve(
        tagName,
        dateStr1Y,
        dateStrTomorrow,
        measure,
      );
    }

    const first100Override: First100Override = {value: null};
    const heavyPromises = this._buildHeavyStatPromises(
      meta,
      initialStats,
      runDelta,
      baseData,
      startDate,
      initialPosts,
      first100Override,
      measure,
    );
    const heavyTasks = [
      {
        id: 'rankings_full',
        label: 'Fetching & resolving rankings...',
        promise: rankingPromise,
      },
      {
        id: 'history',
        label: 'Analyzing monthly trends...',
        promise: heavyPromises.historyPromise,
      },
      {
        id: 'milestones',
        label: 'Checking milestones...',
        promise: heavyPromises.milestonesPromise,
      },
      {
        id: 'resolve_names',
        label: 'Resolving usernames...',
        promise: heavyPromises.first100StatsPromise.then(stats => {
          if (runDelta && baseData?.rankings?.uploader?.first100) return stats;
          if (!stats) return stats;
          return this.dataService.resolveFirst100Names(stats);
        }),
      },
    ];
    const heavyResultsPromise = Promise.all(
      (
        heavyTasks as Array<{
          id: string;
          label: string;
          promise: Promise<unknown>;
        }>
      ).map(trackProgress),
    );

    // --- Phase 1 completes → partial render ---
    const quickStats = await quickStatsPromise;
    log.debug(
      `[Phase 1] Finished Quick Stats in ${(performance.now() - tGroup1Start).toFixed(2)}ms`,
    );

    // Assembly (Phase 1 fields)
    meta.statusCounts = quickStats.statusCounts;
    meta.latestPost = quickStats.latestPost ?? undefined;
    meta.newPostCount = quickStats.newPostCount;
    meta.trendingPost = quickStats.trendingPost ?? undefined;
    meta.trendingPostNSFW = quickStats.trendingPostNSFW ?? undefined;
    meta.copyrightCounts = quickStats.copyrightCounts ?? undefined;
    meta.characterCounts = quickStats.characterCounts ?? undefined;
    meta.commentaryCounts = quickStats.commentaryCounts;

    // Show modal + render the skeleton with Phase 1 data. User sees pie
    // chart + summary now; rankings / history / milestones show as
    // placeholders until Phase 2 replaces them.
    this._showUpdatedStatus(meta.updatedAt);
    this.toggleModal(true);
    this.renderDashboard(meta);

    // --- Phase 2 completes → targeted update ---
    log.debug('[Phase 2] Awaiting Heavy Stats...');
    const heavyResults = await heavyResultsPromise;

    const [resolvedRankings, historyData, milestones, first100StatsRaw] =
      heavyResults as [
        {
          uploaderAll: UserRanking[];
          approverAll: UserRanking[];
          uploaderYear: UserRanking[];
          approverYear: UserRanking[];
        },
        HistoryEntry[],
        MilestoneEntry[],
        (
          | {uploaderRanking: UserRanking[]; approverRanking: UserRanking[]}
          | undefined
        ),
      ];

    // Apply backward-scan first-100 override if available.
    let first100Stats = first100StatsRaw;
    if (first100Override.value) {
      log.debug('Applying updated First 100 Rankings from backward scan.');
      first100Stats = first100Override.value;
      firstPost = initialStats.firstPost;
      hundredthPost = initialStats.hundredthPost;
    }

    const {uploaderAll, approverAll, uploaderYear, approverYear} =
      resolvedRankings;

    // Assembly (Phase 2 fields)
    meta.historyData = historyData;
    meta.precalculatedMilestones = milestones;
    meta.firstPost = firstPost ?? undefined;
    meta.hundredthPost = hundredthPost ?? undefined;
    meta.rankings = {
      uploader: {
        allTime: uploaderAll,
        year: uploaderYear,
        first100: first100Stats?.uploaderRanking ?? [],
      },
      approver: {
        allTime: approverAll,
        year: approverYear,
        first100: first100Stats?.approverRanking ?? [],
      },
    };

    this._updateAfterPhase2(meta);

    // --- Phase 3: Deferred Counts (Rating) ---
    const minDate =
      historyData && historyData.length > 0
        ? new Date(historyData[0].date)
        : new Date('2005-01-01');
    const minDateStr = minDate.toISOString().split('T')[0];

    log.debug(
      `[Phase 3] Starting Deferred Counts (Rating) with startDate: ${minDateStr}`,
    );
    const ratingCounts = await measure(
      'Rating Counts',
      this.dataService.fetchRatingCounts(tagName, minDateStr),
    );
    meta.ratingCounts = ratingCounts;
    this._updateAfterPhase3(meta);

    // --- Ranking SWR revalidation (if cached rankings were served) ---
    // Wait for the background fetch to settle so `saveToCache` persists
    // the fresh data, not the cached ones we rendered earlier. If the
    // fresh report differs from what is currently on `meta.rankings`,
    // swap it in place and re-render the rankings widget. If it matches,
    // skip the DOM churn.
    if (rankingRevalidatePromise) {
      try {
        const fresh = await rankingRevalidatePromise;
        const currentSignature = JSON.stringify({
          uA: meta.rankings?.uploader.allTime,
          aA: meta.rankings?.approver.allTime,
          uY: meta.rankings?.uploader.year,
          aY: meta.rankings?.approver.year,
        });
        const freshSignature = JSON.stringify({
          uA: fresh.uploaderAll,
          aA: fresh.approverAll,
          uY: fresh.uploaderYear,
          aY: fresh.approverYear,
        });
        if (currentSignature !== freshSignature && meta.rankings) {
          log.debug('Ranking SWR: applying fresh report');
          meta.rankings = {
            uploader: {
              allTime: fresh.uploaderAll,
              year: fresh.uploaderYear,
              first100: meta.rankings.uploader.first100,
            },
            approver: {
              allTime: fresh.approverAll,
              year: fresh.approverYear,
              first100: meta.rankings.approver.first100,
            },
          };
          this._updateRankingsWidget(meta);
        } else {
          log.debug('Ranking SWR: cached report still fresh, no update');
        }
      } catch (e) {
        log.warn('Ranking SWR revalidation failed, keeping cached', {
          error: e,
        });
      }
    }

    log.debug(
      `Total analysis time: ${(performance.now() - tTotal).toFixed(2)}ms`,
    );

    // --- Finalize ---
    this.injectAnalyticsButton(meta, 100, '');
    await this.dataService.saveToCache(meta);
  }

  /**
   * Phase 1: Fire off quick stat fetches and await them all.
   */
  private async _runQuickStatsPhase(
    tagName: string,
    meta: TagAnalyticsMeta,
    totalCount: number,
    measure: <T>(label: string, promise: Promise<T>) => Promise<T>,
    trackProgress: <T>(task: {
      id: string;
      label: string;
      promise: Promise<T>;
    }) => Promise<T>,
  ): Promise<QuickStatsResult> {
    log.debug(
      '[Group 1] Queueing Quick Stats (Status, Rating, Latest, Trending, Related)...',
    );

    const statusPromise = measure(
      'Status Counts',
      this.dataService.fetchStatusCounts(tagName),
    );
    const latestPromise = measure(
      'Latest Post',
      this.dataService.fetchLatestPost(tagName),
    );
    const newPostPromise = measure(
      'New Post Count',
      this.dataService.fetchNewPostCount(tagName),
    );
    const trendingPromise = measure(
      'Trending Post (SFW)',
      this.dataService.fetchTrendingPost(tagName, false),
    );
    const trendingNsfwPromise = measure(
      'Trending Post (NSFW)',
      this.dataService.fetchTrendingPost(tagName, true),
    );

    // Related Tags (Category 1=Artist → Copyright+Character, 3=Copyright → Character)
    let copyrightPromise: Promise<Record<string, number> | null> =
      Promise.resolve(null);
    let characterPromise: Promise<Record<string, number> | null> =
      Promise.resolve(null);

    // SWR swap: when the background exact-count fetch completes, replace
    // the approximate counts on `meta` and re-render the pie chart if the
    // user is currently viewing that category. Otherwise the update is
    // invisible until the next tab switch reads fresh `meta` values.
    const onExactCopyright = (exact: Record<string, number>) => {
      meta.copyrightCounts = exact;
      this._rerenderPieIfActive(meta, 'copyright');
    };
    const onExactCharacter = (exact: Record<string, number>) => {
      meta.characterCounts = exact;
      this._rerenderPieIfActive(meta, 'character');
    };

    if (meta.category === 1) {
      copyrightPromise = measure(
        'Related Copyrights',
        this.dataService.fetchRelatedTagDistribution(tagName, 3, totalCount, {
          onExactCounts: onExactCopyright,
        }),
      );
      characterPromise = measure(
        'Related Characters',
        this.dataService.fetchRelatedTagDistribution(tagName, 4, totalCount, {
          onExactCounts: onExactCharacter,
        }),
      );
    } else if (meta.category === 3) {
      characterPromise = measure(
        'Related Characters',
        this.dataService.fetchRelatedTagDistribution(tagName, 4, totalCount, {
          onExactCounts: onExactCharacter,
        }),
      );
    }

    const quickTasks = [
      {id: 'status', label: 'Analyzing post status...', promise: statusPromise},
      {id: 'latest', label: 'Fetching latest info...', promise: latestPromise},
      {
        id: 'new_count',
        label: 'Counting new posts...',
        promise: newPostPromise,
      },
      {
        id: 'trending',
        label: 'Finding trending posts...',
        promise: trendingPromise,
      },
      {
        id: 'trending_nsfw',
        label: 'Finding trending NSFW...',
        promise: trendingNsfwPromise,
      },
      {
        id: 'related_copy',
        label: 'Analyzing related copyrights...',
        promise: copyrightPromise,
      },
      {
        id: 'related_char',
        label: 'Analyzing related characters...',
        promise: characterPromise,
      },
      {
        id: 'commentary',
        label: 'Analyzing commentary status...',
        promise: measure(
          'Commentary Status',
          this.dataService.fetchCommentaryCounts(tagName),
        ),
      },
    ];

    log.debug('[Phase 1] Executing Quick Stats...');
    const quickResults = await Promise.all(
      (
        quickTasks as Array<{
          id: string;
          label: string;
          promise: Promise<unknown>;
        }>
      ).map(trackProgress),
    );

    const [
      statusCounts,
      latestPost,
      newPostCount,
      trendingPost,
      trendingPostNSFW,
      copyrightCounts,
      characterCounts,
      commentaryCounts,
    ] = quickResults as [
      Record<string, number>,
      DanbooruPost | null,
      number,
      DanbooruPost | null,
      DanbooruPost | null,
      Record<string, number> | null,
      Record<string, number> | null,
      Record<string, number>,
    ];

    return {
      statusCounts,
      latestPost,
      newPostCount,
      trendingPost,
      trendingPostNSFW,
      copyrightCounts,
      characterCounts,
      commentaryCounts,
    };
  }

  /**
   * Builds the heavy stat promise chain (history, milestones, first-100 stats).
   * Handles delta-sync vs full-fetch branching and the backward history scan.
   *
   * The backward scan may update `initialStats.firstPost/hundredthPost/timeToHundred`
   * and `first100Override.value` as side effects.
   */
  private _buildHeavyStatPromises(
    meta: TagAnalyticsMeta,
    initialStats: InitialStats,
    runDelta: boolean,
    baseData: TagAnalyticsMeta | null,
    startDate: Date | undefined,
    initialPosts: DanbooruPost[] | null | undefined,
    first100Override: First100Override,
    measure: <T>(label: string, promise: Promise<T>) => Promise<T>,
  ): HeavyStatPromises {
    const tagName = this.tagName;
    const {totalCount} = initialStats;
    const milestoneTargets = this.dataService.getMilestoneTargets(totalCount);

    let historyPromise: Promise<HistoryEntry[]>;
    let milestonesPromise: Promise<MilestoneEntry[]> | undefined;
    let first100StatsPromise: Promise<LocalStats | undefined>;

    if (runDelta && baseData) {
      // --- Delta path ---
      const lastHistory = baseData.historyData[baseData.historyData.length - 1];
      const lastDate = lastHistory
        ? new Date(lastHistory.date)
        : (startDate ?? new Date());
      const deltaStart = new Date(lastDate);
      deltaStart.setDate(deltaStart.getDate() - 7);

      historyPromise = this.dataService
        .fetchHistoryDelta(tagName, deltaStart, startDate ?? new Date())
        .then(delta =>
          this.dataService.mergeHistory(baseData.historyData, delta),
        );

      milestonesPromise = historyPromise.then(fullHistory => {
        return this.dataService
          .fetchMilestonesDelta(
            tagName,
            totalCount,
            baseData.precalculatedMilestones,
            fullHistory,
          )
          .then(delta =>
            this.dataService.mergeMilestones(
              baseData.precalculatedMilestones,
              delta,
            ),
          );
      });

      if (baseData.rankings?.uploader?.first100) {
        initialStats.first100Stats = {
          uploaderRanking: baseData.rankings.uploader.first100,
          approverRanking: baseData.rankings.approver.first100,
          ratingCounts: {},
        };
        first100StatsPromise = Promise.resolve(initialStats.first100Stats);
      } else {
        first100StatsPromise = Promise.resolve(
          this.dataService.calculateLocalStats(initialPosts || []),
        );
      }
    } else {
      // --- Full path ---
      historyPromise = measure(
        'Full History (Monthly)',
        this.dataService.fetchMonthlyCounts(tagName, startDate ?? new Date(), {
          isFullScan: true,
          totalCount,
        }),
      );
      first100StatsPromise = Promise.resolve(
        this.dataService.calculateLocalStats(initialPosts || []),
      );
    }

    // Chain backward scan onto history
    historyPromise = historyPromise.then(
      async (monthlyData: MonthlyHistoryData) => {
        const forwardTotal =
          monthlyData && monthlyData.length > 0
            ? monthlyData[monthlyData.length - 1].cumulative
            : 0;
        let referenceTotal = meta.post_count;

        if (monthlyData.historyCutoff) {
          try {
            const cutoffUrl = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+status:any+date:<${encodeURIComponent(monthlyData.historyCutoff)}`;
            const r = await this.rateLimiter
              .fetch(cutoffUrl)
              .then((res: Response) => res.json());
            referenceTotal =
              (r && r.counts ? r.counts.posts : r ? r.posts : 0) || 0;
          } catch (e) {
            log.warn(
              'Failed to fetch cutoff total, falling back to meta.post_count',
              {error: e},
            );
          }
        }

        log.debug(
          `Reverse Scan Check: ForwardTotal=${forwardTotal}, ReferenceTotal=${referenceTotal}, NeedScan=${forwardTotal < referenceTotal}`,
        );

        if (forwardTotal < referenceTotal && !runDelta) {
          this.injectAnalyticsButton(
            null,
            undefined,
            'Scanning history backwards...',
          );
          const backwardResult = await this.dataService.fetchHistoryBackwards(
            tagName,
            (startDate ?? new Date()).toISOString().slice(0, 10),
            referenceTotal,
            forwardTotal,
          );

          if (backwardResult.length > 0) {
            const backwardShift =
              backwardResult[backwardResult.length - 1].cumulative;
            const adjustedForward = monthlyData.map((h: HistoryEntry) => ({
              ...h,
              cumulative: h.cumulative + backwardShift,
            }));
            const fullHistory = [...backwardResult, ...adjustedForward];

            const earliestDateFound = backwardResult[0].date;
            const realInitialStats = await this.dataService.fetchInitialStats(
              tagName,
              null,
              true,
              earliestDateFound,
            );
            if (realInitialStats) {
              // Mutate initialStats so the caller picks up updated values
              initialStats.firstPost = realInitialStats.firstPost;
              initialStats.hundredthPost = realInitialStats.hundredthPost;
              initialStats.timeToHundred = realInitialStats.timeToHundred;

              if (
                realInitialStats.initialPosts &&
                realInitialStats.initialPosts.length > 0
              ) {
                log.debug(
                  'Recalculating First 100 Rankings for older posts...',
                );
                const newStats = this.dataService.calculateLocalStats(
                  realInitialStats.initialPosts,
                );
                first100Override.value = await this.dataService
                  .resolveFirst100Names(newStats)
                  .catch(e => {
                    log.warn('Failed to resolve names for older posts', {
                      error: e,
                    });
                    return newStats;
                  });
              }
            }
            return fullHistory;
          }
        }
        return monthlyData;
      },
    );

    // Milestones chain (full path only — delta path already set above)
    if (!milestonesPromise) {
      milestonesPromise = historyPromise.then(monthlyData => {
        return this.dataService.fetchMilestones(
          tagName,
          monthlyData || [],
          milestoneTargets,
        );
      });
    }

    return {
      historyPromise,
      milestonesPromise,
      first100StatsPromise,
    };
  }

  /**
   * Injects header controls (Settings, Reset) into the UI.
   * @param {!Element} container The container element.
   */
  injectHeaderControls(container: HTMLElement): void {
    if (document.getElementById('tag-analytics-controls-container')) return;

    const wrapper = document.createElement('span');
    wrapper.id = 'tag-analytics-controls-container';
    container.appendChild(wrapper);

    // 1. Settings Button (Gear)
    const settingsBtn = document.createElement('span');
    settingsBtn.id = 'tag-analytics-settings-btn';
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.style.cursor = 'pointer';
    settingsBtn.style.marginLeft = '6px';
    settingsBtn.style.fontSize = '12px';
    settingsBtn.style.verticalAlign = 'middle';
    settingsBtn.title = 'Configure Data Retention';

    settingsBtn.onclick = e => {
      e.stopPropagation();
      e.preventDefault();
      this.showSettingsPopover(settingsBtn);
    };

    wrapper.appendChild(settingsBtn);

    // 2. Reset Button (Trash)
    const resetBtn = document.createElement('span');
    resetBtn.id = 'tag-analytics-reset-btn';
    resetBtn.innerHTML = '🗑️';
    resetBtn.style.cursor = 'pointer';
    resetBtn.style.marginLeft = '8px';
    resetBtn.style.fontSize = '12px';
    resetBtn.style.verticalAlign = 'middle';
    resetBtn.title = 'Reset Data & Re-fetch';

    resetBtn.onclick = async e => {
      e.stopPropagation();
      e.preventDefault();
      if (
        confirm(
          `Are you sure you want to reset the analytics data for "${this.tagName}"?\nThis will clear the local cache and fetch fresh data.`,
        )
      ) {
        if (this.db && this.db.tag_analytics) {
          try {
            await this.db.tag_analytics.delete(this.tagName);
            log.debug(`Deleted cache for ${this.tagName}`);
            // Close existing modal to prevent conflicts or stale state
            this.toggleModal(false);
            // Re-fetch immediately since user explicitly requested reset
            // Fire-and-forget: triggered by reset button; errors surface in console.
            void this._fetchAndRender();
          } catch (err) {
            log.error('Failed to delete cache:', {error: err});
            showToast({
              type: 'error',
              message: 'Failed to reset data. Check console for details.',
            });
          }
        }
      }
    };

    wrapper.appendChild(resetBtn);
  }

  /**
   * Shows the settings popover for data retention.
   * @param {!Element} target The button element that triggered the popover.
   */
  showSettingsPopover(target: HTMLElement): void {
    // Remove existing
    const existing = document.getElementById('tag-analytics-settings-popover');
    if (existing) existing.remove();

    const currentDays = this.dataService.getRetentionDays();
    const currentThreshold = this.dataService.getSyncThreshold();

    const popover = document.createElement('div');
    popover.id = 'tag-analytics-settings-popover';
    // Sync dashboard theme (popover is appended to body, outside dashboard containers)
    const effective = resolveEffectiveDashboardTheme(
      this.settings.getDarkMode(),
    );
    if (effective === 'dark') popover.setAttribute('data-di-theme', 'dark');
    popover.style.position = 'absolute';
    popover.style.zIndex = '11001';
    popover.style.background = 'var(--di-bg, #fff)';
    popover.style.border = '1px solid var(--di-border, #e1e4e8)';
    popover.style.borderRadius = '6px';
    popover.style.padding = '12px';
    popover.style.boxShadow =
      '0 2px 10px var(--di-shadow-light, rgba(0,0,0,0.1))';
    popover.style.fontSize = '11px';
    popover.style.color = 'var(--di-text, #333)';
    popover.style.width = '260px';

    // Position logic
    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft =
      window.pageXOffset || document.documentElement.scrollLeft;

    popover.style.top = `${rect.top + scrollTop}px`;
    popover.style.left = `${rect.right + scrollLeft + 10}px`;

    popover.innerHTML = `
  <div class="di-section">
    <strong>Data Retention Period</strong><br>
    Records older than this (days) will be deleted.
  </div>
  <div class="di-row di-gapped">
     <input type="number" id="retention-days-input" value="${currentDays}" min="1" step="1">
     <span>days</span>
  </div>

  <div class="di-section di-divider">
    <strong>Sync Threshold</strong><br>
    Run partial sync if new posts exceed this count.
  </div>
  <div class="di-row">
     <input type="number" id="sync-threshold-input" value="${currentThreshold}" min="1" step="1">
     <button id="retention-save-btn" class="di-save-btn">✅ Save</button>
  </div>

  <div class="di-section di-divider">
    <strong>Dashboard Theme</strong>
    <select id="dark-mode-select" style="width:100%; margin-top:4px; padding:3px; border:1px solid var(--di-border-input, #ddd); border-radius:3px; background:var(--di-bg, #fff); color:var(--di-text, #333); font-size:11px;">
      <option value="auto">Auto (follow Danbooru)</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>
`;

    document.body.appendChild(popover);

    // Dark mode select handler
    const darkModeSelect = popover.querySelector(
      '#dark-mode-select',
    ) as HTMLSelectElement;
    if (darkModeSelect) {
      darkModeSelect.value = this.settings.getDarkMode();
      darkModeSelect.addEventListener('change', () => {
        const pref = darkModeSelect.value as 'auto' | 'light' | 'dark';
        this.settings.setDarkMode(pref);
        applyDashboardTheme(this.settings);
      });
    }

    // Close on click outside
    const closeHandler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && e.target !== target) {
        popover.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // Save Handler
    const saveBtn = popover.querySelector('#retention-save-btn');
    (saveBtn as HTMLElement).onclick = () => {
      const daysInput = popover.querySelector('#retention-days-input');
      const thresholdInput = popover.querySelector('#sync-threshold-input');

      const days = parseInt((daysInput as HTMLInputElement).value, 10);
      const threshold = parseInt(
        (thresholdInput as HTMLInputElement).value,
        10,
      );

      if (!isNaN(days) && days > 0 && !isNaN(threshold) && threshold > 0) {
        this.dataService.setRetentionDays(days);
        this.dataService.setSyncThreshold(threshold);

        popover.remove();
        document.removeEventListener('click', closeHandler);
        showToast({
          type: 'success',
          message: `Settings Saved: Retention ${days} days, Sync Threshold ${threshold} posts. Cleaning up old data now...`,
        });
        void this.dataService.cleanupOldCache(); // Run cleanup immediately (fire-and-forget)
      } else {
        showToast({
          type: 'warn',
          message: 'Please enter valid positive numbers.',
        });
      }
    };
  }

  /**
   *Injecsts the main analytics button into the page header.
   * Updates the button state (loading/ready) based on data availability.
   * @param {?Object} tagData The analytics data object.
   * @param {number=} progress The loading progress percentage.
   * @param {string=} statusText Optional text to display next to the button.
   */
  injectAnalyticsButton(
    tagData: TagAnalyticsMeta | null,
    progress?: number,
    statusText?: string,
  ): void {
    let title = document.querySelector(
      '#c-wiki-pages #a-show h1, #c-artists #a-show h1, #tag-show #posts h1, #tag-list h1',
    );

    // Fallback: Try finding container via post-count (common in modern Danbooru layouts)
    if (!title) {
      const postCount = document.querySelector(
        '.post-count, span[class*="post-count"]',
      );
      if (postCount && postCount.parentElement) {
        title = postCount.parentElement;
      }
    }

    if (!title) {
      log.warn('Could not find a suitable title element for button injection.');
      return;
    }

    // Check if button already exists to avoid duplicates, but allow updating it
    let btn = document.getElementById('tag-analytics-btn');
    const isNew = !btn;

    if (isNew) {
      btn = document.createElement('button');
      btn.id = 'tag-analytics-btn';
      btn.setAttribute('aria-label', 'View tag analytics dashboard');
      btn.style.marginLeft = '10px';
      btn.style.border = 'none';
      btn.style.background = 'transparent';
      btn.style.fontSize = '1.5rem';
      btn.style.verticalAlign = 'middle';

      btn.innerHTML = `
        <div class="di-tag-analytics-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--di-link, #007bff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
        </div>
      `;
      title.appendChild(btn);
    }

    // Status Label Logic
    let statusLabel = document.getElementById('tag-analytics-status');
    if (!statusLabel) {
      statusLabel = document.createElement('span');
      statusLabel.id = 'tag-analytics-status';
      statusLabel.style.marginLeft = '10px';
      statusLabel.style.fontSize = '14px';
      statusLabel.style.color = 'var(--di-text-muted, #888)';
      statusLabel.style.verticalAlign = 'middle';
      statusLabel.style.fontFamily = 'sans-serif';

      // Insert after button
      if (btn && btn.nextSibling) {
        btn.parentNode?.insertBefore(statusLabel, btn.nextSibling);
      } else if (btn) {
        btn.parentNode?.appendChild(statusLabel);
      }
    }

    if (statusText) {
      statusLabel.textContent = statusText;
      statusLabel.style.display = 'inline';
    } else {
      statusLabel.textContent = '';
      statusLabel.style.display = 'none';
    }

    if (!btn) return;

    const isReady =
      tagData &&
      !!(
        tagData.historyData &&
        tagData.precalculatedMilestones &&
        tagData.statusCounts &&
        tagData.ratingCounts
      );
    const iconContainer = btn.querySelector('.icon-container');

    if (isReady) {
      // Ready: data is available, open modal on click
      btn.style.cursor = 'pointer';
      btn.title = 'View Tag Analytics';
      if (iconContainer) {
        (iconContainer as HTMLElement).style.opacity = '1';
        (iconContainer as HTMLElement).style.filter = 'none';
      }
      btn.onclick = () => {
        this.toggleModal(true);
        this.renderDashboard(tagData);
      };
    } else if (this.isFetching) {
      // Loading: fetch in progress, block interaction
      btn.style.cursor = 'wait';
      btn.title = `Analytics Data is loading... ${(progress ?? 0) > 0 ? progress + '%' : 'Please wait.'}`;
      if (iconContainer) {
        (iconContainer as HTMLElement).style.opacity = '0.5';
        (iconContainer as HTMLElement).style.filter = 'grayscale(1)';
      }
      btn.onclick = () => {
        showToast({
          type: 'warn',
          message: `Report data is still being calculated (${progress ?? 0}%). It will be ready in a few seconds.`,
        });
      };
    } else {
      // Idle: not yet fetched, click to start
      btn.style.cursor = 'pointer';
      btn.title = 'Load Tag Analytics (Click to start)';
      if (iconContainer) {
        (iconContainer as HTMLElement).style.opacity = '1';
        (iconContainer as HTMLElement).style.filter = 'none';
      }
      btn.onclick = async () => {
        await this._fetchAndRender();
      };
    }
  }

  /**
   * Creates the modal overlay for the dashboard.
   */
  createModal(): void {
    if (document.getElementById('tag-analytics-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'tag-analytics-modal';

    // Apply dashboard theme attribute
    const effective = resolveEffectiveDashboardTheme(
      this.settings.getDarkMode(),
    );
    if (effective === 'dark') modal.setAttribute('data-di-theme', 'dark');
    modal.style.display = 'none';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.style.zIndex = '10000';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';

    modal.innerHTML = `
          <div>
              <button id="tag-analytics-close">&times;</button>
              <div id="tag-analytics-content">
                  <h2>Loading...</h2>
              </div>
          </div>
      `;

    document.body.appendChild(modal);

    // Close handlers
    const closeBtn = document.getElementById('tag-analytics-close');
    if (closeBtn) closeBtn.onclick = () => this.toggleModal(false);
    modal.onclick = e => {
      if (e.target === modal) this.toggleModal(false);
    };

    // Keyboard: close on Escape
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        this.toggleModal(false);
      }
    });

    // Close on browser back button (mobile-friendly)
    window.addEventListener('popstate', () => {
      if (
        modal.style.display !== 'none' &&
        history.state?.diModalOpen !== 'tag-analytics-modal'
      ) {
        this.toggleModal(false);
      }
    });
  }

  /**
   * Toggles the visibility of the dashboard modal.
   * @param {boolean} show Whether to show or hide the modal.
   */
  toggleModal(show: boolean): void {
    if (!document.getElementById('tag-analytics-modal')) {
      this.createModal();
    }
    const modal = document.getElementById('tag-analytics-modal');
    if (!modal) return;

    if (show) {
      // Push history state for back button support
      if (history.state?.diModalOpen !== 'tag-analytics-modal') {
        history.pushState(
          {diModalOpen: 'tag-analytics-modal'},
          '',
          location.href,
        );
      }
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      const closeBtn = document.getElementById('tag-analytics-close');
      if (closeBtn) closeBtn.focus();
    } else {
      // If history state still belongs to us, route through history.back().
      // The popstate listener will re-enter this branch with state cleared.
      if (history.state?.diModalOpen === 'tag-analytics-modal') {
        history.back();
        return;
      }
      modal.style.display = 'none';
      document.body.style.overflow = '';
      this.chartRenderer.cleanup();
      // Remove any lingering area chart tooltips appended to body
      d3.select('body').selectAll('.tag-analytics-tooltip').remove();
    }
  }

  /**
   * Updates the visibility of NSFW content based on user settings.
   * Toggles blur/opacity on marked elements.
   */
  updateNsfwVisibility(): void {
    const isNsfwEnabled =
      localStorage.getItem('tag_analytics_nsfw_enabled') === 'true';
    const items = document.querySelectorAll('.di-nsfw-monitor');

    items.forEach(item => {
      const rating = item.getAttribute('data-rating');

      if (isNsfwEnabled) {
        // NSFW Enabled: Show everything
        // item.style.display = 'flex'; // No need to toggle display if we only touch image
        const img = item.querySelector('img');
        if (img) {
          img.style.filter = 'none';
          img.style.opacity = '1';
        }
      } else {
        // NSFW Disabled: Hide 'q' and 'e' thumbnails
        if (rating === 'q' || rating === 'e') {
          // item.style.display = 'none'; // Don't hide the card
          const img = item.querySelector('img');
          if (img) {
            img.style.filter = 'blur(10px) grayscale(100%)';
            img.style.opacity = '0.3';
          }
        } else {
          // Safe content: Ensure visible
          const img = item.querySelector('img');
          if (img) {
            img.style.filter = 'none';
            img.style.opacity = '1';
          }
        }
      }
    });

    // Update Checkbox State if it exists
    const cb = document.getElementById('tag-analytics-nsfw-toggle');
    if (cb) (cb as HTMLInputElement).checked = isNsfwEnabled;

    // Toggle Trending Post Visibility
    const trendingSFW = document.getElementById('trending-post-sfw');
    const trendingNSFW = document.getElementById('trending-post-nsfw');

    if (isNsfwEnabled) {
      if (trendingSFW) trendingSFW.style.display = 'none';
      if (trendingNSFW) trendingNSFW.style.display = 'flex';
    } else {
      if (trendingSFW) trendingSFW.style.display = 'flex';
      if (trendingNSFW) trendingNSFW.style.display = 'none';
    }
  }

  /**
   * Builds the dashboard header HTML: tag name, category badge, dates, NSFW toggle.
   */
  private buildDashboardHeader(
    tagData: TagAnalyticsMeta,
    titleColor: string,
    categoryLabel: string,
  ): string {
    return `
      <div class="di-tag-header">
          <div>
              <h2 style="color: ${titleColor};">${escapeHtml(tagData.name.replace(/_/g, ' '))}</h2>
              <div class="di-tag-header-meta">
                  <span class="di-category-badge">${categoryLabel}</span>
                  <span class="di-tag-header-date">Created: ${tagData.created_at ? new Date(tagData.created_at).toLocaleDateString('en-CA') : 'N/A'}</span>
                  <span class="di-tag-header-date di-tag-header-date-updated" id="tag-updated-at">
                      Updated: ${tagData.updatedAt ? new Date(tagData.updatedAt).toLocaleDateString('en-CA') : 'N/A'}
                      <span id="tag-settings-anchor"></span>
                  </span>
              </div>
          </div>
          <div>
              <label class="di-tag-header-nsfw">
                  <input type="checkbox" id="tag-analytics-nsfw-toggle">
                  Enable NSFW
              </label>
          </div>
      </div>
    `;
  }

  /**
   * Builds the main grid HTML: Summary card (totals, trending thumbnails) +
   * Distribution card (pie chart tabs).
   */
  private buildMainGrid(tagData: TagAnalyticsMeta): string {
    const totalUploads =
      tagData.historyData && tagData.historyData.length > 0
        ? tagData.historyData
            .reduce((a: number, b: HistoryEntry) => a + b.count, 0)
            .toLocaleString()
        : '0';

    const latestPostHtml = tagData.latestPost
      ? `
      <div class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.latestPost.rating}">
         <div class="di-nsfw-monitor-thumb di-nsfw-monitor-thumb-latest">
            <a href="/posts/${tagData.latestPost.id}" target="_blank">
                <img src="${getBestThumbnailUrl(tagData.latestPost)}" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div class="di-nsfw-monitor-label">Latest</div>
         <div class="di-nsfw-monitor-sublabel">${tagData.latestPost.created_at.split('T')[0]}</div>
      </div>
    `
      : '';

    const trendingSfwHtml = tagData.trendingPost
      ? `
      <div id="trending-post-sfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPost.rating}">
         <div class="di-nsfw-monitor-thumb di-nsfw-monitor-thumb-trending">
            <a href="/posts/${tagData.trendingPost.id}" target="_blank">
                  <img src="${getBestThumbnailUrl(tagData.trendingPost)}" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div class="di-nsfw-monitor-label-trending">Trending(3d)</div>
         <div class="di-nsfw-monitor-sublabel">Score: ${tagData.trendingPost.score}</div>
      </div>
    `
      : '';

    const trendingNsfwHtml = tagData.trendingPostNSFW
      ? `
      <div id="trending-post-nsfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPostNSFW.rating}">
         <div class="di-nsfw-monitor-thumb di-nsfw-monitor-thumb-trending-nsfw">
            <a href="/posts/${tagData.trendingPostNSFW.id}" target="_blank">
                  <img src="${getBestThumbnailUrl(tagData.trendingPostNSFW)}" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div class="di-nsfw-monitor-label-trending-nsfw">Trending(NSFW)</div>
         <div class="di-nsfw-monitor-sublabel">Score: ${tagData.trendingPostNSFW.score}</div>
      </div>
    `
      : '';

    const extraPieTabsHtml = `
      ${tagData.copyrightCounts ? '<button class="di-pie-tab" data-type="copyright">Copyright</button>' : ''}
      ${tagData.characterCounts ? '<button class="di-pie-tab" data-type="character">Character</button>' : ''}
      ${tagData.commentaryCounts ? '<button class="di-pie-tab" data-type="commentary">Commentary</button>' : ''}
    `;

    return `
      <!-- Main Grid: Summary & Distribution -->
      <div class="di-summary-grid">
           <!-- Summary Card -->
           <div class="di-card di-flex-col-between di-summary-card">
              <div class="di-summary-card-top">
                  <div>
                      <div class="di-summary-stat-label">Total Uploads</div>
                      <div class="di-summary-stat-value">${totalUploads}</div>
                      <div class="di-summary-stat-trend">
                          +${tagData.newPostCount || 0} <span class="di-summary-stat-trend-meta">(24h)</span>
                      </div>
                  </div>
                  <!-- Right Side: Latest & Trending -->
                  <div class="di-summary-card-thumbs">
                      ${latestPostHtml}
                      ${trendingSfwHtml}
                      ${trendingNsfwHtml}
                  </div>
              </div>
           </div>

           <!-- Distribution Card -->
           <div class="di-distribution-card">
              <div class="di-distribution-header">
                 <div class="di-distribution-title">Distribution</div>
                 <div class="pie-tabs">
                    <button class="di-pie-tab active" data-type="status">Status</button>
                    <button class="di-pie-tab" data-type="rating">Rating</button>
                    ${extraPieTabsHtml}
                 </div>
              </div>
              <div id="status-pie-chart-wrapper">
                 <div id="status-pie-chart"></div>
                 <div id="status-pie-legend"></div>
              </div>
              <div id="status-pie-loading">Loading data...</div>
           </div>
      </div>
    `;
  }

  /**
   * Builds the user rankings section HTML: uploader/approver tab bar + ranking columns.
   */
  private buildRankingsSection(tagData: TagAnalyticsMeta): string {
    // Always emit the wrapper so progressive rendering can inject the
    // real content after Phase 2 (heavy stats) without needing to locate
    // an insertion anchor in the surrounding HTML.
    const inner = tagData.rankings
      ? this.buildRankingsContent(tagData)
      : '<div id="di-rankings-placeholder" class="di-rankings-loading">Analyzing user rankings…</div>';
    return `<div id="di-rankings-slot">${inner}</div>`;
  }

  /**
   * Inner HTML for the rankings section (header + three columns).
   * Extracted so `_updateRankingsWidget` can drop it into the slot once
   * Phase 2 data arrives without rebuilding the whole dashboard.
   */
  private buildRankingsContent(tagData: TagAnalyticsMeta): string {
    if (!tagData.rankings) return '';
    log.debug('renderDashboard - Initial Render - hundredthPost:', {
      hundredthPost: tagData.hundredthPost,
    });
    const hundredthPostId = tagData.hundredthPost
      ? tagData.hundredthPost.id
      : null;
    return `
      <div class="di-rankings-section">
           <div class="di-rankings-header">
              <h3 class="di-rankings-title">User Rankings</h3>
              <div class="di-rank-tabs">
                  <button class="rank-tab active" data-role="uploader">Uploaders</button>
                  <button class="rank-tab" data-role="approver">Approvers</button>
              </div>
           </div>
           <div id="ranking-container">
              ${this.chartRenderer.renderRankingColumn('All-time', tagData.rankings.uploader.allTime, 'uploader', tagData.name, this.dataService.userNames)}
              ${this.chartRenderer.renderRankingColumn('Last 1 Year', tagData.rankings.uploader.year, 'uploader', tagData.name, this.dataService.userNames)}
              ${this.chartRenderer.renderRankingColumn('First 100 Post', tagData.rankings.uploader.first100, 'uploader', tagData.name, this.dataService.userNames, hundredthPostId)}
           </div>
      </div>
    `;
  }

  /**
   * Builds the bottom sections HTML: milestones container + charts container.
   */
  private buildBottomSections(): string {
    return `
      <!-- Milestones Container -->
      <div id="tag-analytics-milestones">
          <div class="di-milestones-header">
              <h2>Milestones</h2>
              <button id="tag-milestones-toggle">Show More</button>
          </div>
          <div id="milestones-loading">Checking milestones...</div>
          <div id="tag-milestones-grid-container" class="milestones-grid"></div>
      </div>

      <!-- Charts Container -->
      <div id="tag-analytics-charts">
          <h2>Post History</h2>
          <div id="chart-loading">Loading History Data...</div>
          <div id="history-chart-monthly"></div>
          <div id="history-chart-cumulative"></div>
      </div>
    `;
  }

  /**
   * Renders the full analytics dashboard into the modal.
   *
   * Layout Overview:
   * - Header: Tag name, category, created/updated dates, NSFW toggle.
   * - Main Grid (2 columns on large screens):
   *   1. Summary Card: Total uploads, 24h trend, latest/trending posts thumbnails.
   *   2. Distribution Card: Pie chart with tabs (Status, Rating, etc.) and legend.
   * - User Rankings: Uploader and Approver leaderboards.
   * - History Graph: Monthly uploads bar chart.
   * - Milestone Cards (if any).
   *
   * @param {!Object} tagData The complete analytics data to render.
   */
  renderDashboard(tagData: TagAnalyticsMeta): void {
    if (!document.getElementById('tag-analytics-modal')) {
      this.createModal();
    }

    const content = document.getElementById('tag-analytics-content');
    if (!content) return;
    const categoryMap: Record<number, string> = {
      1: 'Artist',
      3: 'Copyright',
      4: 'Character',
    };
    const categoryLabel = categoryMap[tagData.category] || 'Unknown';

    const colorMap: Record<number, string> = {
      1: '#c00004', // Artist - Red
      3: '#a800aa', // Copyright - Purple/Magenta
      4: '#00ab2c', // Character - Green
    };
    const titleColor = colorMap[tagData.category] || 'var(--di-text, #333)';

    content.innerHTML = `
      ${this.buildDashboardHeader(tagData, titleColor, categoryLabel)}
      ${this.buildMainGrid(tagData)}
      ${this.buildRankingsSection(tagData)}
      ${this.buildBottomSections()}
      ${dashboardFooterHtml()}
    `;

    // Inject Header Controls (Settings, Reset)
    const anchor = document.getElementById('tag-settings-anchor');
    if (anchor) this.injectHeaderControls(anchor);

    // NSFW Logic
    const nsfwCheck = document.getElementById('tag-analytics-nsfw-toggle');
    if (nsfwCheck) {
      (nsfwCheck as HTMLInputElement).checked =
        localStorage.getItem('tag_analytics_nsfw_enabled') === 'true';
      nsfwCheck.onchange = e => {
        localStorage.setItem(
          'tag_analytics_nsfw_enabled',
          (e.target as HTMLInputElement).checked.toString(),
        );
        this.updateNsfwVisibility();
      };
      // Apply initial state
      this.updateNsfwVisibility();
    }

    // ----- Per-phase rendering (decoupled predicates) -----
    // Progressive rendering calls `renderDashboard` once after Phase 1
    // (Quick Stats) with partial data, then calls the `_updateAfterPhase*`
    // helpers as heavier data arrives. Each of the blocks below handles
    // exactly one data dependency so missing data → placeholder, present
    // data → rendered, independent of the other blocks.

    // Pie chart + pie tabs (requires statusCounts only — rating/copyright/
    // character/commentary tabs each render their own slice when clicked).
    if (tagData.statusCounts) {
      this.chartRenderer.renderPieChart('status', tagData);
      this._wirePieTabHandlers(tagData);
    }

    // History charts + milestones (Phase 2 data).
    this._renderHistoryAndMilestones(tagData);

    // Ranking tab handlers (Phase 2 data).
    if (tagData.rankings) {
      this._wireRankTabHandlers(tagData);
    }
  }

  /**
   * Renders history charts + milestones given the current tagData state.
   * No-op if Phase 2 data isn't ready yet — the "Loading…" placeholders
   * in `buildBottomSections` stay visible until a later call supplies it.
   */
  private _renderHistoryAndMilestones(tagData: TagAnalyticsMeta): void {
    const data = tagData.historyData || [];
    const loading = document.getElementById('chart-loading');

    if (data.length > 0) {
      if (loading) loading.style.display = 'none';
      this.chartRenderer.renderHistoryCharts(
        data,
        this.tagName,
        tagData.precalculatedMilestones,
      );

      const milestonesContainer = document.getElementById(
        'tag-analytics-milestones',
      );
      if (milestonesContainer) {
        milestonesContainer.style.display = 'block';
        const targets = this.dataService.getMilestoneTargets(
          tagData.post_count,
        );
        const nextTarget = this.dataService.getNextMilestoneTarget(
          tagData.post_count,
        );
        const nextInfo = {totalPosts: tagData.post_count, nextTarget};

        if (tagData.precalculatedMilestones) {
          this.chartRenderer.renderMilestones(
            tagData.precalculatedMilestones,
            () => this.updateNsfwVisibility(),
            nextInfo,
          );
        } else {
          this.dataService
            .fetchMilestones(tagData.name, [], targets)
            .then((milestonePosts: MilestoneEntry[]) => {
              this.chartRenderer.renderMilestones(
                milestonePosts,
                () => this.updateNsfwVisibility(),
                nextInfo,
              );
            })
            .catch((err: unknown) => {
              log.error('Failed to fetch milestones:', {error: err});
            });
        }
      }
    }
    // When historyData is missing, leave the "Loading History Data…"
    // placeholder from buildBottomSections visible — Phase 2 update will
    // either fill it or flip it to "No history data available." below.
  }

  /** Binds click handlers to the pie-chart category tabs. */
  private _wirePieTabHandlers(tagData: TagAnalyticsMeta): void {
    const tabs = document.querySelectorAll('.di-pie-tab');
    tabs.forEach(tab => {
      (tab as HTMLElement).onclick = () => {
        const newType = tab.getAttribute('data-type');
        tabs.forEach(t => {
          t.classList.remove('active');
          (t as HTMLElement).style.background = '';
          (t as HTMLElement).style.color = '';
        });
        tab.classList.add('active');
        this.chartRenderer.renderPieChart(newType ?? 'status', tagData);
      };
    });
  }

  /** Binds click handlers to the uploader/approver rank tabs. */
  private _wireRankTabHandlers(tagData: TagAnalyticsMeta): void {
    const rankTabs = document.querySelectorAll('.rank-tab');
    rankTabs.forEach(tab => {
      (tab as HTMLElement).onclick = () => {
        const role = tab.getAttribute('data-role');
        rankTabs.forEach(t => {
          t.classList.remove('active');
          (t as HTMLElement).style.fontWeight = 'normal';
          (t as HTMLElement).style.color = 'var(--di-text-muted, #888)';
        });
        tab.classList.add('active');
        (tab as HTMLElement).style.fontWeight = 'bold';
        (tab as HTMLElement).style.color = 'var(--di-link, #007bff)';

        this.chartRenderer.updateRankingTabs(
          role ?? 'uploader',
          tagData,
          this.dataService.userNames,
        );
      };
    });
  }

  /**
   * Phase 2 update — injects rankings content into the placeholder slot,
   * renders history charts + milestones, and updates the "Total Uploads"
   * counter. Runs after Phase 1's partial render, so the pie chart and
   * summary thumbnails stay intact (no DOM thrashing).
   */
  private _updateAfterPhase2(tagData: TagAnalyticsMeta): void {
    // 1) Rankings: replace placeholder slot with real content, re-wire tabs.
    const slot = document.getElementById('di-rankings-slot');
    if (slot && tagData.rankings) {
      slot.innerHTML = this.buildRankingsContent(tagData);
      this._wireRankTabHandlers(tagData);
    }

    // 2) History + milestones.
    this._renderHistoryAndMilestones(tagData);

    // 3) Total Uploads counter (derived from historyData).
    const total =
      tagData.historyData && tagData.historyData.length > 0
        ? tagData.historyData.reduce((a, b) => a + b.count, 0).toLocaleString()
        : null;
    if (total !== null) {
      const el = document.querySelector(
        '.di-summary-card .di-summary-stat-value',
      );
      if (el) el.textContent = total;
    }

    // 4) If history is empty, surface the "no data" message.
    if (!tagData.historyData || tagData.historyData.length === 0) {
      const loading = document.getElementById('chart-loading');
      if (loading) {
        loading.textContent = 'No history data available.';
        loading.style.display = 'block';
      }
    }
  }

  /**
   * Phase 3 update — ratingCounts arrived. If the rating pie tab is
   * currently active, re-render it with fresh data; otherwise leave it
   * for the next tab click.
   */
  private _updateAfterPhase3(tagData: TagAnalyticsMeta): void {
    const activeTab = document.querySelector('.di-pie-tab.active');
    if (activeTab?.getAttribute('data-type') === 'rating') {
      this.chartRenderer.renderPieChart('rating', tagData);
    }
  }

  /**
   * Replaces the rankings slot with fresh content. Preserves the
   * currently-active rank tab (uploader/approver) across the rebuild by
   * reading `.rank-tab.active` before tearing down and clicking the
   * equivalent tab afterward.
   */
  private _updateRankingsWidget(tagData: TagAnalyticsMeta): void {
    const slot = document.getElementById('di-rankings-slot');
    if (!slot || !tagData.rankings) return;

    const activeTab = slot.querySelector('.rank-tab.active');
    const activeRole = activeTab?.getAttribute('data-role') ?? 'uploader';

    slot.innerHTML = this.buildRankingsContent(tagData);
    this._wireRankTabHandlers(tagData);

    // buildRankingsContent always starts with 'uploader' active. If the
    // user was on 'approver', click the corresponding tab to restore
    // state (also triggers the chart update).
    if (activeRole === 'approver') {
      const tabEl = slot.querySelector('.rank-tab[data-role="approver"]');
      if (tabEl instanceof HTMLElement) tabEl.click();
    }
  }
}
