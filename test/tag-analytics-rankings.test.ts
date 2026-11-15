/**
 * Tag page uploader / approver rankings from `/reports/posts.json` (T-205).
 *
 * A failed report used to be read as its error body and come back as an
 * empty ranking, which was rendered and then saved over the cached one for
 * a day. A failure is now reported as such, and the cached ranking stays.
 */
import {describe, it, expect, vi, afterEach} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import type {TagAnalyticsMeta, UserRanking} from '../src/types';

vi.mock('d3', () => ({}));

import {
  TagAnalyticsChartRenderer,
  rankingFailed,
} from '../src/apps/tag-analytics-charts';
import {
  TagAnalyticsDataService,
  cachedRankingResult,
  keepCachedOnFailure,
  keepKnownRankings,
  type RankingResult,
} from '../src/apps/tag-analytics-data';

afterEach(() => {
  vi.restoreAllMocks();
});

type Reply = {ok: boolean; status: number; json: () => Promise<unknown>};
const reply = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function makeService(fetchImpl: (url: string) => Promise<Reply>) {
  const rl = {fetch: vi.fn(fetchImpl)};
  const service = new TagAnalyticsDataService(
    {} as unknown as Database,
    rl as unknown as RateLimitedFetch,
    'test_tag',
  );
  vi.spyOn(service, 'fetchUserMap').mockResolvedValue(new Map());
  vi.spyOn(service, 'fetchUserMapByNames').mockResolvedValue(new Map());
  return {service, rl};
}

const passThrough = <T>(_label: string, p: Promise<T>) => p;
const ranking = (name: string, count: number): UserRanking[] => [
  {id: 1, name, level: null, count},
];

describe('fetchReportRanking', () => {
  it('returns the rows of a successful report', async () => {
    const rows = [{uploader: 'alice', posts: 5}];
    const {service, rl} = makeService(async () => reply(200, rows));

    const result = await service.fetchReportRanking(
      'tag',
      'uploader',
      '2025-01-01',
      '2026-01-01',
    );

    expect(result).toEqual(rows);
    const url = decodeURIComponent(rl.fetch.mock.calls[0][0]);
    expect(url).toContain('search[group_limit]=10');
    expect(url).toContain('search[from]=2025-01-01');
  });

  it.each([429, 500, 422])('throws on HTTP %i', async status => {
    const {service} = makeService(async () =>
      reply(status, {success: false, message: 'nope'}),
    );
    await expect(
      service.fetchReportRanking('tag', 'uploader', '', ''),
    ).rejects.toThrow(`HTTP ${status}`);
  });

  it('throws on a 200 that is not a list', async () => {
    const {service} = makeService(async () => reply(200, {error: 'x'}));
    await expect(
      service.fetchReportRanking('tag', 'approver', '', ''),
    ).rejects.toThrow();
  });
});

describe('fetchRankingsAndResolve', () => {
  it('lists a failed report in `failed` instead of passing it off as empty', async () => {
    const {service} = makeService(async url => {
      const u = decodeURIComponent(url);
      if (u.includes('group]=approver') && u.includes('from]=2025-06-01')) {
        return reply(500, {});
      }
      return reply(200, [{uploader: 'alice', approver: 'bob', posts: 3}]);
    });

    const result = await service.fetchRankingsAndResolve(
      'tag',
      '2025-06-01',
      '2026-06-02',
      passThrough,
    );

    expect(result.failed).toEqual(['approverYear']);
    expect(result.approverYear).toEqual([]);
    expect(result.uploaderAll).toHaveLength(1);
  });

  it('has no `failed` when every report came back', async () => {
    const {service} = makeService(async () => reply(200, []));
    const result = await service.fetchRankingsAndResolve(
      'tag',
      '2025-06-01',
      '2026-06-02',
      passThrough,
    );
    expect(result.failed).toBeUndefined();
  });
});

describe('keepKnownRankings (the report to save)', () => {
  const report = (
    name: string,
    failed?: TagAnalyticsMeta['rankingsFailed'],
  ): TagAnalyticsMeta =>
    ({
      rankings: {
        uploader: {
          allTime: failed?.includes('uploaderAll') ? [] : ranking(name, 9),
          year: ranking(`${name}_year`, 3),
          first100: ranking(`${name}_first`, 1),
        },
        approver: {
          allTime: failed?.includes('approverAll') ? [] : ranking(name, 8),
          year: ranking(`${name}_year`, 2),
          first100: [],
        },
      },
      rankingsFailed: failed,
    }) as unknown as TagAnalyticsMeta;

  it('a failed ranking keeps the saved one, with no delta run to do it', () => {
    const fresh = report('new', ['uploaderAll', 'approverAll']);
    const saved = keepKnownRankings(fresh, report('old'));

    expect(saved.rankings.uploader.allTime).toEqual(ranking('old', 9));
    expect(saved.rankings.approver.allTime).toEqual(ranking('old', 8));
    // What did come back is this run's.
    expect(saved.rankings.uploader.year).toEqual(ranking('new_year', 3));
    expect(saved.rankings.uploader.first100).toEqual(ranking('new_first', 1));
    expect(saved.rankingsFailed).toBeUndefined();
    // The open dashboard keeps showing what the run got.
    expect(fresh.rankingsFailed).toEqual(['uploaderAll', 'approverAll']);
  });

  it('keeps the failure when the saved ranking failed too, or there is none', () => {
    const fresh = report('new', ['uploaderAll']);
    expect(keepKnownRankings(fresh, report('old', ['uploaderAll']))).toBe(
      fresh,
    );
    expect(keepKnownRankings(fresh, undefined)).toBe(fresh);
  });

  it('leaves a report without failures as it is', () => {
    const fresh = report('new');
    expect(keepKnownRankings(fresh, report('old'))).toBe(fresh);
  });
});

describe('keepCachedOnFailure', () => {
  const cached: RankingResult = {
    uploaderAll: ranking('old_up_all', 50),
    approverAll: ranking('old_ap_all', 40),
    uploaderYear: ranking('old_up_year', 5),
    approverYear: ranking('old_ap_year', 4),
  };

  it('keeps the cached ranking for each failed slot, takes the rest', () => {
    const fresh: RankingResult = {
      uploaderAll: ranking('new_up_all', 51),
      approverAll: [],
      uploaderYear: ranking('new_up_year', 6),
      approverYear: [],
      failed: ['approverAll', 'approverYear'],
    };

    const out = keepCachedOnFailure(fresh, cached);

    expect(out.uploaderAll).toBe(fresh.uploaderAll);
    expect(out.uploaderYear).toBe(fresh.uploaderYear);
    expect(out.approverAll).toBe(cached.approverAll);
    expect(out.approverYear).toBe(cached.approverYear);
    expect(out.failed).toBeUndefined();
  });

  it('a failed slot with nothing cached stays empty and failed', () => {
    const fresh: RankingResult = {
      uploaderAll: [],
      approverAll: ranking('a', 1),
      uploaderYear: ranking('b', 1),
      approverYear: ranking('c', 1),
      failed: ['uploaderAll'],
    };

    const out = keepCachedOnFailure(fresh, null);

    expect(out.uploaderAll).toEqual([]);
    expect(out.failed).toEqual(['uploaderAll']);
  });

  it('does not take a cached list that was itself a failure', () => {
    const fresh: RankingResult = {
      uploaderAll: [],
      approverAll: ranking('a', 1),
      uploaderYear: ranking('b', 1),
      approverYear: ranking('c', 1),
      failed: ['uploaderAll'],
    };
    const failedBefore: RankingResult = {
      ...cached,
      uploaderAll: [],
      failed: ['uploaderAll'],
    };

    const out = keepCachedOnFailure(fresh, failedBefore);

    expect(out.uploaderAll).toEqual([]);
    expect(out.failed).toEqual(['uploaderAll']);
  });

  it('a successful empty ranking does replace the cache (nobody, really)', () => {
    const fresh: RankingResult = {
      uploaderAll: [],
      approverAll: [],
      uploaderYear: [],
      approverYear: [],
    };
    expect(keepCachedOnFailure(fresh, cached)).toBe(fresh);
  });
});

describe('cachedRankingResult', () => {
  it('maps a saved report onto the four slots', () => {
    const r = ranking('x', 1);
    expect(
      cachedRankingResult({
        rankings: {
          uploader: {allTime: r, year: [], first100: []},
          approver: {allTime: [], year: r, first100: []},
        },
      }),
    ).toEqual({
      uploaderAll: r,
      approverAll: [],
      uploaderYear: [],
      approverYear: r,
    });
  });

  it('is null without a saved report', () => {
    expect(cachedRankingResult(null)).toBeNull();
    expect(cachedRankingResult({} as never)).toBeNull();
  });

  it('gives back the slots the report saved as failed', () => {
    const result = cachedRankingResult({
      rankings: {
        uploader: {allTime: [], year: [], first100: []},
        approver: {allTime: [], year: [], first100: []},
      },
      rankingsFailed: ['approverYear', 'uploaderAll'],
    });
    expect(result?.failed).toEqual(['uploaderAll', 'approverYear']);
  });
});

describe('a ranking Danbooru did not return', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const viewer = (level: string) =>
    vi.stubGlobal('document', {body: {dataset: {currentUserLevel: level}}});
  const column = (failed: boolean) =>
    new TagAnalyticsChartRenderer().renderRankingColumn(
      'All-time',
      [],
      'uploader',
      'touhou',
      {},
      null,
      failed,
    );

  it('says a logged-out search timed out, instead of "No Data"', () => {
    viewer('0');
    const html = column(true);
    expect(html).toContain('logged-out searches stop after 3 seconds');
    expect(html).not.toContain('No Data');
  });

  it('says it is fetched again for a logged-in viewer', () => {
    viewer('20');
    expect(column(true)).toContain('could not return this ranking');
  });

  it('keeps "No Data" for a ranking that came back empty', () => {
    viewer('0');
    expect(column(false)).toContain('No Data');
  });

  it('reads the failed slots of a report by role and period', () => {
    const meta = {rankingsFailed: ['approverYear']} as TagAnalyticsMeta;
    expect(rankingFailed(meta, 'approver', 'Year')).toBe(true);
    expect(rankingFailed(meta, 'approver', 'All')).toBe(false);
    expect(rankingFailed({} as TagAnalyticsMeta, 'uploader', 'All')).toBe(
      false,
    );
  });
});
