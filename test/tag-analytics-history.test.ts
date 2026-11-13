/**
 * A tag's monthly history from Danbooru's reports (T-302, PLAN.md 4.2):
 * one report for the whole range (layer 1), the range in halves while the
 * server times out (layer 2), and one count per month as the last resort
 * (layer 3). Before this, every first visit cost one count per month
 * since the tag's first post, counted in the viewer's time zone.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import type {MonthlyCountRecord} from '../src/types';

vi.mock('d3', () => ({}));
vi.mock('../src/core/quota-manager', () => ({
  bulkPutSafe: async (
    table: {bulkPut: (r: unknown) => Promise<unknown>},
    records: unknown,
  ) => table.bulkPut(records),
  evictOldestNonCurrentUser: async () => undefined,
}));

import {
  REPORT_HISTORY_MAX_REQUESTS,
  TagAnalyticsDataService,
  hasUtcHistory,
} from '../src/apps/tag-analytics-data';

const NOW = new Date('2026-11-13T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Reply = {ok: boolean; status: number; json: () => Promise<unknown>};
const reply = (status: number, body: unknown = {}): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** `YYYY-MM` keys from `from` to `to` (inclusive). */
function months(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * A reports reply the way Danbooru builds it: a row for every month from
 * `from` to `to`, newest first. A month counts its posts only if its first
 * day is inside `[from, to)`, since `to` reaches just 00:00 of its day.
 */
function reportRows(
  from: string,
  to: string,
  postsIn: (month: string) => number,
): Array<{date: string; posts: number}> {
  return months(from.slice(0, 7), to.slice(0, 7))
    .map(month => {
      const first = `${month}-01`;
      const inside = first >= from && first < to;
      return {date: first, posts: inside ? postsIn(month) : 0};
    })
    .reverse();
}

function makeDb(cache = new Map<string, MonthlyCountRecord>()) {
  const monthly = {
    bulkGet: vi.fn(async (keys: Array<[string, string]>) =>
      keys.map(([, ym]) => cache.get(ym)),
    ),
    bulkPut: vi.fn(async (records: MonthlyCountRecord[]) => {
      for (const r of records) cache.set(r.yearMonth, r);
    }),
    where: vi.fn(() => ({equals: () => ({delete: async () => 0})})),
  };
  const tagAnalytics = {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
  };
  return {
    db: {tag_monthly_counts: monthly, tag_analytics: tagAnalytics},
    monthly,
    cache,
  };
}

function makeService(
  serve: (url: string) => Reply,
  cache?: Map<string, MonthlyCountRecord>,
) {
  const {db, monthly} = makeDb(cache);
  const rl = {fetch: vi.fn(async (url: string) => serve(url))};
  const service = new TagAnalyticsDataService(
    db as unknown as Database,
    rl as unknown as RateLimitedFetch,
    'test_tag',
  );
  const reportCalls = () =>
    rl.fetch.mock.calls
      .map(c => c[0] as string)
      .filter(u => u.startsWith('/reports/'));
  const countCalls = () =>
    rl.fetch.mock.calls
      .map(c => decodeURIComponent(c[0] as string))
      .filter(u => u.startsWith('/counts/'));
  return {service, rl, monthly, reportCalls, countCalls};
}

const rangeOf = (url: string) => {
  const q = new URLSearchParams(url.split('?')[1]);
  return {from: q.get('search[from]')!, to: q.get('search[to]')!};
};

/** One post a month from 2015-01: 143 months up to 2026-11. */
const onePerMonthSince2015 = (month: string) => (month >= '2015-01' ? 1 : 0);

describe('fetchMonthlyHistory — layer 1', () => {
  it('reads the whole history from one report, without the month cache', async () => {
    const {service, monthly, reportCalls, countCalls} = makeService(url => {
      const {from, to} = rangeOf(url);
      return reply(200, reportRows(from, to, onePerMonthSince2015));
    });

    const result = await service.fetchMonthlyHistory('test_tag');

    expect(result.layer).toBe(1);
    expect(result.partial).toBe(false);
    expect(reportCalls()).toHaveLength(1);
    expect(rangeOf(reportCalls()[0])).toEqual({
      from: '2005-01-01',
      to: '2026-11-15',
    });
    expect(countCalls()).toEqual([]);
    expect(monthly.bulkPut).not.toHaveBeenCalled();

    const h = result.history;
    expect(h[0]).toEqual({date: '2015-01-01', count: 1, cumulative: 1});
    expect(h.at(-1)).toEqual({date: '2026-11-01', count: 1, cumulative: 143});
    expect(h).toHaveLength(143);
  });

  it('asks a report that hit the reports limit (429) once more', async () => {
    let calls = 0;
    const {service, reportCalls} = makeService(url => {
      if (++calls === 1) return reply(429);
      const {from, to} = rangeOf(url);
      return reply(200, reportRows(from, to, onePerMonthSince2015));
    });

    const result = await service.fetchMonthlyHistory('test_tag');

    expect(result.layer).toBe(1);
    expect(reportCalls()).toHaveLength(2);
  });
});

describe('fetchMonthlyHistory — layer 2', () => {
  /** Times out on any range longer than `maxMonths`. */
  const timesOutPast = (maxMonths: number) => (url: string) => {
    if (!url.startsWith('/reports/')) return reply(404);
    const {from, to} = rangeOf(url);
    if (months(from.slice(0, 7), to.slice(0, 7)).length > maxMonths) {
      return reply(500, {success: false, message: 'The database timed out'});
    }
    return reply(200, reportRows(from, to, onePerMonthSince2015));
  };

  it('halves a timed-out range and adds the halves up month by month', async () => {
    const {service, reportCalls} = makeService(timesOutPast(150));

    const result = await service.fetchMonthlyHistory('test_tag');

    expect(result.layer).toBe(2);
    expect(result.partial).toBe(false);
    expect(reportCalls()).toHaveLength(3);
    // The month the halves meet in is complete, not 0 and not 2.
    const counts = result.history.map(e => e.count);
    expect(new Set(counts)).toEqual(new Set([1]));
    expect(result.history).toHaveLength(143);
    expect(result.history.at(-1)?.cumulative).toBe(143);
  });

  it('caches the closed months, from 2005, and the next run asks only for the rest', async () => {
    const cache = new Map<string, MonthlyCountRecord>();
    const first = makeService(timesOutPast(150), cache);
    await first.service.fetchMonthlyHistory('test_tag');

    // Two or more months back, the leading empty ones included.
    expect(cache.has('2005-01')).toBe(true);
    expect(cache.get('2005-01')?.count).toBe(0);
    expect(cache.get('2026-09')?.count).toBe(1);
    expect(cache.has('2026-10')).toBe(false);

    const second = makeService(timesOutPast(150), cache);
    const result = await second.service.fetchMonthlyHistory('test_tag');

    expect(second.reportCalls()).toHaveLength(1);
    expect(rangeOf(second.reportCalls()[0]).from).toBe('2026-10-01');
    expect(result.layer).toBe(2);
    expect(result.history).toHaveLength(143);
    expect(result.history.at(-1)?.cumulative).toBe(143);
  });

  it('does not read month rows saved before UTC months', async () => {
    const cache = new Map<string, MonthlyCountRecord>();
    await makeService(timesOutPast(150), cache).service.fetchMonthlyHistory(
      'test_tag',
    );
    // The same rows as an older version wrote them: no `basis`.
    for (const [ym, r] of cache) {
      cache.set(ym, {
        tag: r.tag,
        yearMonth: ym,
        count: r.count,
        fetchedAt: r.fetchedAt,
      });
    }

    const again = makeService(timesOutPast(150), cache);
    await again.service.fetchMonthlyHistory('test_tag');

    expect(rangeOf(again.reportCalls()[0]).from).toBe('2005-01-01');
  });

  it('starts from 2005 again once a cached month has expired', async () => {
    const cache = new Map<string, MonthlyCountRecord>();
    await makeService(timesOutPast(150), cache).service.fetchMonthlyHistory(
      'test_tag',
    );
    // 2010-06 is 77 months back: valid for 180 days. Age it past that.
    cache.set('2010-06', {...cache.get('2010-06')!, fetchedAt: 0});

    const again = makeService(timesOutPast(150), cache);
    await again.service.fetchMonthlyHistory('test_tag');

    expect(rangeOf(again.reportCalls()[0]).from).toBe('2010-06-01');
  });
});

describe('fetchMonthlyHistory — layer 3', () => {
  /** Reports always time out; counts give 2 a month, but August fails. */
  function reportsDown(url: string): Reply {
    if (url.startsWith('/reports/')) return reply(500);
    const tags = decodeURIComponent(url.split('tags=')[1] ?? '');
    if (tags.includes('date:2026-08-01T00:00:00Z')) return reply(502);
    return reply(200, {counts: {posts: 2}});
  }

  it('counts month by month in UTC when the reports cannot give it, marked partial when a month is lost', async () => {
    const {service, reportCalls, countCalls} = makeService(reportsDown);

    const result = await service.fetchMonthlyHistory('test_tag', {
      startDate: '2026-08-15',
    });

    expect(result.layer).toBe(3);
    expect(result.partial).toBe(true);
    expect(reportCalls().length).toBeLessThanOrEqual(
      REPORT_HISTORY_MAX_REQUESTS,
    );
    expect(result.history.map(e => [e.date, e.count])).toEqual([
      ['2026-08-01', 0], // lost: shown, but the caller must not cache it
      ['2026-09-01', 2],
      ['2026-10-01', 2],
      ['2026-11-01', 2],
    ]);
    // Explicit UTC instants, not dates read in the viewer's time zone.
    expect(countCalls()).toContain(
      '/counts/posts.json?tags=test_tag status:any date:2026-09-01T00:00:00Z...2026-10-01T00:00:00Z',
    );
  });

  it('stops splitting at the request budget', async () => {
    const {service, reportCalls} = makeService(reportsDown);
    await service.fetchMonthlyHistory('test_tag', {startDate: '2026-10-01'});
    // 263 months halve down to 12-month pieces well before 24 requests run
    // out; either way the budget is never exceeded.
    expect(reportCalls().length).toBeGreaterThan(1);
    expect(reportCalls().length).toBeLessThanOrEqual(
      REPORT_HISTORY_MAX_REQUESTS,
    );
  });

  it('does not split a report that failed for another reason', async () => {
    const {service, reportCalls} = makeService(url =>
      url.startsWith('/reports/')
        ? reply(200, '<!DOCTYPE html>')
        : reply(200, {counts: {posts: 1}}),
    );

    const result = await service.fetchMonthlyHistory('test_tag', {
      startDate: '2026-11-01',
    });

    expect(reportCalls()).toHaveLength(1);
    expect(result.layer).toBe(3);
    expect(result.partial).toBe(false);
    expect(result.history).toEqual([
      {date: '2026-11-01', count: 1, cumulative: 1},
    ]);
  });
});

describe('hasUtcHistory', () => {
  it('is true only for records marked as UTC months', () => {
    expect(hasUtcHistory({historyBasis: 'utc'})).toBe(true);
    expect(hasUtcHistory({})).toBe(false);
    expect(hasUtcHistory(null)).toBe(false);
    expect(hasUtcHistory(undefined)).toBe(false);
  });
});
