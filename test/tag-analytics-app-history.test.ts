// @vitest-environment jsdom
/**
 * The tag page's history wiring (T-303): the history comes whole from
 * `fetchMonthlyHistory`, the first posts are fetched again when it starts
 * before them, a partial history is not saved, and cached reports from
 * before UTC months are not used.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import type {SettingsManager} from '../src/core/settings';
import type {
  DanbooruPost,
  DanbooruTag,
  HistoryEntry,
  TagAnalyticsMeta,
} from '../src/types';

vi.mock('d3', () => ({}));

import {TagAnalyticsApp} from '../src/apps/tag-analytics-app';
import {
  TagAnalyticsDataService,
  type InitialStats,
  type MonthlyHistory,
  type RankingResult,
} from '../src/apps/tag-analytics-data';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The private steps under test. */
type AppInternals = {
  _refreshFirstPostsIfOlder(
    history: HistoryEntry[],
    startDate: Date | undefined,
    initialStats: InitialStats,
    first100Override: {value: unknown},
  ): Promise<void>;
  _fetchLargeTag(
    meta: TagAnalyticsMeta,
    initialStats: InitialStats,
    runDelta: boolean,
    baseData: TagAnalyticsMeta | null,
    startDate: Date | undefined,
    initialPosts: DanbooruPost[] | null | undefined,
  ): Promise<void>;
};

function makeApp(): {app: TagAnalyticsApp; internals: AppInternals} {
  const app = new TagAnalyticsApp(
    {} as unknown as Database,
    {} as unknown as SettingsManager,
    'test_tag',
    {fetch: vi.fn()} as unknown as RateLimitedFetch,
  );
  vi.spyOn(app, 'injectAnalyticsButton').mockImplementation(() => {});
  return {app, internals: app as unknown as AppInternals};
}

const post = (id: number, createdAt: string) =>
  ({id, created_at: createdAt}) as unknown as DanbooruPost;

const month = (date: string, count: number, cumulative: number) => ({
  date,
  count,
  cumulative,
});

function initialStats(firstPost?: DanbooruPost): InitialStats {
  return {
    firstPost,
    hundredthPost: null,
    totalCount: 5000,
    startDate: firstPost ? new Date(firstPost.created_at) : undefined,
    timeToHundred: null,
    meta: {} as DanbooruTag,
    initialPosts: [],
  };
}

describe('_refreshFirstPostsIfOlder', () => {
  const history = [
    month('2015-01-01', 3, 3),
    month('2015-02-01', 0, 3),
    month('2016-03-01', 9, 12),
  ];

  it('fetches the first posts again from the first month when the history starts earlier', async () => {
    const {app, internals} = makeApp();
    const older = post(1, '2015-01-07T00:00:00Z');
    const fetchInitial = vi
      .spyOn(app.dataService, 'fetchInitialStats')
      .mockResolvedValue({
        ...initialStats(older),
        hundredthPost: post(100, '2015-06-01T00:00:00Z'),
        timeToHundred: 145,
        initialPosts: [older],
      });
    const resolved = {
      ratingCounts: {},
      uploaderRanking: [],
      approverRanking: [],
    };
    vi.spyOn(app.dataService, 'resolveFirst100Names').mockResolvedValue(
      resolved,
    );
    const stats = initialStats(post(50, '2016-03-10T00:00:00Z'));
    const override = {value: null as unknown};

    await internals._refreshFirstPostsIfOlder(
      history,
      stats.startDate,
      stats,
      override,
    );

    // 12 posts in all: the range never reaches 200, so it stays open.
    expect(fetchInitial).toHaveBeenCalledWith(
      'test_tag',
      null,
      true,
      'date:>=2015-01-01T00:00:00Z',
    );
    expect(stats.firstPost).toBe(older);
    expect(stats.timeToHundred).toBe(145);
    expect(override.value).toBe(resolved);
  });

  it('asks the narrow UTC range of the first 200 posts, once more after a failure', async () => {
    const {app, internals} = makeApp();
    const older = post(1, '2005-05-03T00:00:00Z');
    const fetchInitial = vi
      .spyOn(app.dataService, 'fetchInitialStats')
      // The first attempt comes back empty (a 500 reads as no posts).
      .mockResolvedValueOnce({...initialStats(), initialPosts: []})
      .mockResolvedValueOnce({...initialStats(older), initialPosts: [older]});
    vi.spyOn(app.dataService, 'resolveFirst100Names').mockImplementation(
      async s => s,
    );
    const stats = initialStats(post(50, '2013-03-01T00:00:00Z'));

    await internals._refreshFirstPostsIfOlder(
      [
        month('2005-05-01', 40, 40),
        month('2005-06-01', 100, 140),
        month('2005-07-01', 90, 230),
        month('2005-08-01', 500, 730),
      ],
      stats.startDate,
      stats,
      {value: null},
    );

    expect(fetchInitial).toHaveBeenCalledTimes(2);
    expect(fetchInitial).toHaveBeenLastCalledWith(
      'test_tag',
      null,
      true,
      'date:2005-05-01T00:00:00Z...2005-08-01T00:00:00Z',
    );
    expect(stats.firstPost).toBe(older);
  });

  it('leaves them alone when the history starts in the first post month', async () => {
    const {app, internals} = makeApp();
    const fetchInitial = vi.spyOn(app.dataService, 'fetchInitialStats');
    const first = post(1, '2015-01-20T00:00:00Z');
    const stats = initialStats(first);
    const override = {value: null};

    await internals._refreshFirstPostsIfOlder(
      history,
      stats.startDate,
      stats,
      override,
    );

    expect(fetchInitial).not.toHaveBeenCalled();
    expect(stats.firstPost).toBe(first);
    expect(override.value).toBeNull();
  });

  it('compares UTC months: late on the last day east of UTC is still that month', async () => {
    const {app, internals} = makeApp();
    const fetchInitial = vi.spyOn(app.dataService, 'fetchInitialStats');
    // 2015-02-01 01:00 in UTC+9 is 2015-01-31 16:00 UTC: January.
    const stats = initialStats(post(1, '2015-02-01T01:00:00+09:00'));

    await internals._refreshFirstPostsIfOlder(history, stats.startDate, stats, {
      value: null,
    });

    expect(fetchInitial).not.toHaveBeenCalled();
  });

  it('keeps the first posts it had when the older ones come back empty twice', async () => {
    const {app, internals} = makeApp();
    const fetchInitial = vi
      .spyOn(app.dataService, 'fetchInitialStats')
      .mockResolvedValue({...initialStats(), initialPosts: []});
    const first = post(50, '2016-03-10T00:00:00Z');
    const stats = initialStats(first);
    const override = {value: null};

    await internals._refreshFirstPostsIfOlder(
      history,
      stats.startDate,
      stats,
      override,
    );

    expect(fetchInitial).toHaveBeenCalledTimes(2);
    expect(stats.firstPost).toBe(first);
    expect(override.value).toBeNull();
  });
});

describe('fetchInitialStats search', () => {
  function makeService() {
    const fetch = vi.fn(
      async (_url: string) =>
        ({
          ok: true,
          status: 200,
          json: async () => [post(7, '2005-05-03T00:00:00Z')],
        }) as unknown as Response,
    );
    const service = new TagAnalyticsDataService(
      {} as unknown as Database,
      {fetch} as unknown as RateLimitedFetch,
      'touhou',
    );
    vi.spyOn(service, 'fetchTagData').mockResolvedValue({
      name: 'touhou',
      post_count: 5000,
      created_at: '2013-02-28T00:00:00Z',
      category: 3,
    } as DanbooruTag);
    const tags = () =>
      new URLSearchParams(fetch.mock.calls[0][0].split('?')[1]).get('tags');
    return {service, tags};
  }

  it('searches the date term it is given instead of the creation date', async () => {
    const {service, tags} = makeService();
    await service.fetchInitialStats(
      'touhou',
      null,
      true,
      'date:2005-05-01T00:00:00Z...2005-08-01T00:00:00Z',
    );
    expect(tags()).toBe(
      'touhou date:2005-05-01T00:00:00Z...2005-08-01T00:00:00Z',
    );
  });

  it('searches from the creation date without one', async () => {
    const {service, tags} = makeService();
    await service.fetchInitialStats('touhou');
    expect(tags()).toBe('touhou date:>=2013-02-28T00:00:00Z');
  });
});

describe('_fetchLargeTag history', () => {
  function runLargeTag(
    history: MonthlyHistory,
    rankingsFailed?: RankingResult['failed'],
  ) {
    const {app, internals} = makeApp();
    const ds = app.dataService;
    const proto = TagAnalyticsApp.prototype as unknown as Record<
      string,
      unknown
    >;
    vi.spyOn(
      proto as {_runQuickStatsPhase: () => Promise<unknown>},
      '_runQuickStatsPhase',
    ).mockResolvedValue({
      statusCounts: {},
      latestPost: null,
      newPostCount: 0,
      trendingPost: null,
      trendingPostNSFW: null,
      copyrightCounts: null,
      characterCounts: null,
      commentaryCounts: {},
      translationCounts: {},
    });
    vi.spyOn(app, 'renderDashboard').mockImplementation(() => {});
    vi.spyOn(app, 'toggleModal').mockImplementation(() => {});
    vi.spyOn(app, '_showUpdatedStatus').mockImplementation(() => {});
    vi.spyOn(ds, 'fetchRankingsAndResolve').mockResolvedValue({
      uploaderAll: [],
      approverAll: [],
      uploaderYear: [],
      approverYear: [],
      ...(rankingsFailed ? {failed: rankingsFailed} : {}),
    });
    const fetchHistory = vi
      .spyOn(ds, 'fetchMonthlyHistory')
      .mockResolvedValue(history);
    vi.spyOn(ds, 'fetchMilestones').mockResolvedValue([]);
    vi.spyOn(ds, 'resolveFirst100Names').mockImplementation(async s => s);
    vi.spyOn(ds, 'fetchRatingCounts').mockResolvedValue({});
    const save = vi.spyOn(ds, 'saveToCache').mockResolvedValue();

    const meta = {post_count: 5000, updatedAt: 1} as TagAnalyticsMeta;
    const stats = initialStats(post(1, '2015-01-07T00:00:00Z'));
    const done = internals._fetchLargeTag(
      meta,
      stats,
      false,
      null,
      stats.startDate,
      [],
    );
    return {done, meta, save, fetchHistory};
  }

  const fullHistory: MonthlyHistory = {
    history: [month('2015-01-01', 3, 3), month('2015-02-01', 2, 5)],
    layer: 1,
    partial: false,
  };

  it('takes the history whole from fetchMonthlyHistory and saves it as UTC months', async () => {
    const {done, meta, save, fetchHistory} = runLargeTag(fullHistory);
    await done;

    expect(fetchHistory).toHaveBeenCalledWith('test_tag', {
      startDate: new Date('2015-01-07T00:00:00Z'),
      totalCount: 5000,
    });
    expect(meta.historyData).toEqual(fullHistory.history);
    expect(meta.historyBasis).toBe('utc');
    expect(save).toHaveBeenCalledWith(meta);
  });

  it('saves which rankings Danbooru did not return, so a cache hit shows them as such', async () => {
    const {done, meta, save} = runLargeTag(fullHistory, [
      'uploaderAll',
      'approverAll',
    ]);
    await done;

    expect(meta.rankingsFailed).toEqual(['uploaderAll', 'approverAll']);
    expect(save).toHaveBeenCalledWith(meta);
  });

  it('shows a partial history but does not save the report', async () => {
    const {done, meta, save} = runLargeTag({...fullHistory, partial: true});
    await done;

    expect(meta.historyData).toEqual(fullHistory.history);
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      'Some months of the history could not be loaded',
    );
  });
});

describe('loadFromCache and the UTC mark', () => {
  function makeService(data: Partial<TagAnalyticsMeta>) {
    const del = vi.fn(async () => 1);
    const db = {
      tag_analytics: {
        get: vi.fn(async () => ({
          tagName: 'test_tag',
          updatedAt: Date.now(),
          data,
        })),
      },
      tag_monthly_counts: {
        where: vi.fn(() => ({equals: () => ({delete: del})})),
      },
    };
    const service = new TagAnalyticsDataService(
      db as unknown as Database,
      {fetch: vi.fn()} as unknown as RateLimitedFetch,
      'test_tag',
    );
    return {service, del};
  }

  it('does not use a report from before UTC months, and drops its month rows', async () => {
    const {service, del} = makeService({historyData: []});
    expect(await service.loadFromCache()).toBeNull();
    expect(del).toHaveBeenCalled();
  });

  it('uses a report saved with UTC months', async () => {
    const {service, del} = makeService({historyData: [], historyBasis: 'utc'});
    const loaded = await service.loadFromCache();
    expect(loaded?.historyBasis).toBe('utc');
    expect(del).not.toHaveBeenCalled();
  });
});
