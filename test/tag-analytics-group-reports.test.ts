/**
 * Rating and status counts of a tag page from grouped reports (T-306):
 * one `search[group]=rating` report instead of four rating counts, and one
 * `search[group]=is_deleted` report instead of the deleted and active
 * counts. The counts remain the fallback.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';

vi.mock('d3', () => ({}));

import {
  TagAnalyticsDataService,
  parseGroupReport,
} from '../src/apps/tag-analytics-data';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const reply = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

/** Serves reports from `report` and counts from `counts` (by tag query). */
function makeService(
  report: (url: string) => Response,
  counts: Record<string, number> = {},
) {
  const rl = {
    fetch: vi.fn(async (url: string) => {
      if (url.startsWith('/reports/')) return report(url);
      const tags = decodeURIComponent(url.split('tags=')[1] ?? '');
      return reply(200, {counts: {posts: counts[tags] ?? 0}});
    }),
  };
  const service = new TagAnalyticsDataService(
    {} as unknown as Database,
    rl as unknown as RateLimitedFetch,
    'touhou',
  );
  const calls = () => rl.fetch.mock.calls.map(c => c[0] as string);
  return {service, calls};
}

const paramsOf = (url: string) =>
  Object.fromEntries(new URLSearchParams(url.split('?')[1]));

describe('parseGroupReport', () => {
  it('reads rows per value, booleans as strings', () => {
    expect([
      ...parseGroupReport(
        [
          {rating: 'g', posts: 10},
          {rating: 'e', posts: 2},
        ],
        'rating',
      ),
    ]).toEqual([
      ['g', 10],
      ['e', 2],
    ]);
    expect(
      parseGroupReport(
        [
          {is_deleted: false, posts: 90},
          {is_deleted: true, posts: 7},
        ],
        'is_deleted',
      ).get('true'),
    ).toBe(7);
  });

  it.each([
    ['an error object', {success: false}],
    ['a row without the column', [{posts: 3}]],
    ['a row without a count', [{rating: 'g'}]],
    ['a negative count', [{rating: 'g', posts: -1}]],
  ])('fails on %s', (_label, body) => {
    expect(() => parseGroupReport(body, 'rating')).toThrow();
  });
});

describe('fetchRatingCounts', () => {
  it('takes all four ratings from one report, from the start date on', async () => {
    const {service, calls} = makeService(() =>
      reply(200, [
        {rating: 's', posts: 40},
        {rating: 'g', posts: 100},
        {rating: 'q', posts: 5},
      ]),
    );

    const ratings = await service.fetchRatingCounts('touhou', '2008-03-01');

    // No row for `e`: no explicit posts.
    expect(ratings).toEqual({g: 100, s: 40, q: 5, e: 0});
    expect(calls()).toHaveLength(1);
    expect(paramsOf(calls()[0])).toMatchObject({
      'search[tags]': 'touhou',
      'search[group]': 'rating',
      'search[from]': '2008-03-01',
    });
  });

  it('asks from 2005 without a start date (the report defaults to a month)', async () => {
    const {service, calls} = makeService(() => reply(200, []));
    await service.fetchRatingCounts('touhou');
    expect(paramsOf(calls()[0])['search[from]']).toBe('2005-01-01');
  });

  it('counts each rating when the report fails', async () => {
    const {service, calls} = makeService(() => reply(500, {}), {
      'touhou rating:g': 1,
      'touhou rating:s': 2,
      'touhou rating:q': 3,
      'touhou rating:e': 4,
    });

    const ratings = await service.fetchRatingCounts('touhou');

    expect(ratings).toEqual({g: 1, s: 2, q: 3, e: 4});
    expect(calls().filter(u => u.startsWith('/counts/'))).toHaveLength(4);
  });
});

describe('fetchStatusCounts', () => {
  const statusCounts = {
    'touhou status:appealed': 1,
    'touhou status:banned': 3,
    'touhou status:flagged': 2,
    'touhou status:pending': 4,
    'touhou status:deleted': 70,
    'touhou status:active': 900,
  };

  it('takes deleted and active from one report and counts the other four', async () => {
    const {service, calls} = makeService(
      () =>
        reply(200, [
          {is_deleted: false, posts: 906},
          {is_deleted: true, posts: 70},
        ]),
      statusCounts,
    );

    const statuses = await service.fetchStatusCounts('touhou');

    expect(statuses).toEqual({
      active: 900, // 906 not deleted − 4 pending − 2 flagged
      appealed: 1,
      banned: 3,
      deleted: 70,
      flagged: 2,
      pending: 4,
    });
    const countQueries = calls()
      .filter(u => u.startsWith('/counts/'))
      .map(u => decodeURIComponent(u.split('tags=')[1]));
    expect(countQueries.sort()).toEqual([
      'touhou status:appealed',
      'touhou status:banned',
      'touhou status:flagged',
      'touhou status:pending',
    ]);
  });

  it('counts deleted and active when the report fails, the other four only once', async () => {
    const {service, calls} = makeService(
      () => reply(200, '<!DOCTYPE html>'),
      statusCounts,
    );

    const statuses = await service.fetchStatusCounts('touhou');

    expect(statuses).toEqual({
      active: 900,
      appealed: 1,
      banned: 3,
      deleted: 70,
      flagged: 2,
      pending: 4,
    });
    // Six counts, as before the report: nothing fetched twice.
    expect(calls().filter(u => u.startsWith('/counts/'))).toHaveLength(6);
  });
});
