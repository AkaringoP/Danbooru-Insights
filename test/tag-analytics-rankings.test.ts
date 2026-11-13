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
import type {UserRanking} from '../src/types';

vi.mock('d3', () => ({}));

import {
  TagAnalyticsDataService,
  cachedRankingResult,
  keepCachedOnFailure,
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
});
