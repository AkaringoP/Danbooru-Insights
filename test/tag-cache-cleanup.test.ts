// @vitest-environment jsdom
/**
 * Tag cache cleanup (T-309). Through v9.11 `cleanupOldCache` deleted only
 * expired `tag_analytics` reports: their `tag_monthly_counts` rows stayed
 * forever, and `tag_implications_cache` rows past their 180-day TTL were
 * skipped on read but never removed.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Database} from '../src/core/database';
import type {RateLimitedFetch} from '../src/core/rate-limiter';
import {TagAnalyticsDataService} from '../src/apps/tag-analytics-data';
import {
  IMPLICATIONS_CACHE_TTL_MS,
  pruneImplicationCache,
} from '../src/core/top-level-tags';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 14);
const SWEEP_KEY = 'di.tagCache.sweptAt';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

type Row = Record<string, unknown>;

/** The Dexie calls the cleanup makes, over an array. */
function fakeTable(rows: Row[], key: (r: Row) => string) {
  const remove = (pred: (r: Row) => boolean) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (pred(rows[i])) rows.splice(i, 1);
    }
    return before - rows.length;
  };
  type Collection = {
    primaryKeys(): Promise<string[]>;
    delete(): Promise<number>;
    filter(more: (r: Row) => boolean): Collection;
  };
  const collection = (pred: (r: Row) => boolean): Collection => ({
    primaryKeys: async () => rows.filter(pred).map(key),
    delete: async () => remove(pred),
    filter: more => collection(r => pred(r) && more(r)),
  });
  return {
    where: (field: string) => ({
      below: (v: number) => collection(r => (r[field] as number) < v),
      anyOf: (vs: unknown[]) => collection(r => vs.includes(r[field])),
    }),
    toCollection: () => collection(() => true),
    filter: (pred: (r: Row) => boolean) => collection(pred),
    bulkDelete: async (keys: string[]) => {
      remove(r => keys.includes(key(r)));
    },
  };
}

function makeDb(reports: Row[], months: Row[], implications: Row[] = []) {
  const transaction = vi.fn(
    async (_mode: string, _a: unknown, _b: unknown, fn: () => unknown) => fn(),
  );
  const db = {
    tag_analytics: fakeTable(reports, r => r.tagName as string),
    tag_monthly_counts: fakeTable(months, r => `${r.tag}|${r.yearMonth}`),
    tag_implications_cache: fakeTable(implications, r => r.tagName as string),
    transaction,
  };
  const service = new TagAnalyticsDataService(
    db as unknown as Database,
    {fetch: vi.fn()} as unknown as RateLimitedFetch,
    'touhou',
  );
  return {db, service, transaction};
}

const report = (tagName: string, ageDays: number): Row => ({
  tagName,
  updatedAt: NOW - ageDays * DAY,
  data: {},
});

/** A month row; `legacy` = written before T-303, without `basis`. */
const month = (
  tag: string,
  yearMonth: string,
  ageDays: number,
  legacy = false,
): Row => ({
  tag,
  yearMonth,
  count: 5,
  fetchedAt: NOW - ageDays * DAY,
  ...(legacy ? {} : {basis: 'utc'}),
});

const tagsOf = (rows: Row[]) => rows.map(r => `${r.tag} ${r.yearMonth}`);

describe('cleanupOldCache: expired reports', () => {
  it('deletes a report past the retention period with its month rows, in one transaction', async () => {
    // Today's sweep already ran: only the expiry path is under test.
    localStorage.setItem(SWEEP_KEY, String(NOW));
    const reports = [report('old_tag', 8), report('fresh_tag', 1)];
    const months = [
      month('old_tag', '2020-01', 30),
      month('old_tag', '2020-02', 2),
      month('fresh_tag', '2020-01', 30),
    ];
    const {db, service, transaction} = makeDb(reports, months);

    await service.cleanupOldCache(NOW);

    expect(reports.map(r => r.tagName)).toEqual(['fresh_tag']);
    expect(tagsOf(months)).toEqual(['fresh_tag 2020-01']);
    expect(transaction).toHaveBeenCalledWith(
      'rw',
      db.tag_analytics,
      db.tag_monthly_counts,
      expect.any(Function),
    );
  });

  it('follows the retention setting', async () => {
    localStorage.setItem(SWEEP_KEY, String(NOW));
    localStorage.setItem('danbooru_tag_analytics_retention', '30');
    const reports = [report('old_tag', 8)];
    const {service} = makeDb(reports, []);

    await service.cleanupOldCache(NOW);

    expect(reports).toHaveLength(1);
  });
});

describe('cleanupOldCache: daily sweep', () => {
  function sweepFixture() {
    const reports = [report('live_tag', 1)];
    const months = [
      // Owned by a report: kept however old.
      month('live_tag', '2019-01', 100),
      // No report, fetched before the retention period: an orphan.
      month('gone_tag', '2019-01', 8),
      // No report yet, fetched just now: a first visit still running.
      month('new_tag', '2019-01', 0),
      // Viewer-time-zone months (before T-303): never read, so dropped.
      month('live_tag', '2018-12', 1, true),
    ];
    const implications = [
      {tagName: 'reimu', fetchedAt: NOW - 181 * DAY},
      {tagName: 'consequent:touhou', fetchedAt: NOW - 181 * DAY},
      {tagName: 'marisa', fetchedAt: NOW - 10 * DAY},
    ];
    return {reports, months, implications};
  }

  it('drops month rows no report owns and old-basis rows, and expired implication rows', async () => {
    const {reports, months, implications} = sweepFixture();
    const {service} = makeDb(reports, months, implications);

    await service.cleanupOldCache(NOW);

    expect(tagsOf(months)).toEqual(['live_tag 2019-01', 'new_tag 2019-01']);
    expect(implications.map(r => r.tagName)).toEqual(['marisa']);
    expect(localStorage.getItem(SWEEP_KEY)).toBe(String(NOW));
  });

  it('runs once a day', async () => {
    const {reports, months} = sweepFixture();
    const {service} = makeDb(reports, months);
    await service.cleanupOldCache(NOW);

    months.push(month('gone_again', '2019-01', 8));
    await service.cleanupOldCache(NOW + 23 * 60 * 60 * 1000);
    expect(tagsOf(months)).toContain('gone_again 2019-01');

    await service.cleanupOldCache(NOW + 25 * 60 * 60 * 1000);
    expect(tagsOf(months)).not.toContain('gone_again 2019-01');
  });

  it('still prunes the implication rows when the month sweep fails, and does not retry it on the next open', async () => {
    const {reports, months, implications} = sweepFixture();
    const {db, service} = makeDb(reports, months, implications);
    const sweep = vi
      .spyOn(db.tag_monthly_counts, 'filter')
      .mockImplementation(() => {
        throw new Error('boom');
      });

    await service.cleanupOldCache(NOW);
    await service.cleanupOldCache(NOW + 60 * 1000);

    expect(implications.map(r => r.tagName)).toEqual(['marisa']);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

describe('pruneImplicationCache', () => {
  it('deletes by the TTL and reports how many went', async () => {
    const implications = [
      {tagName: 'a', fetchedAt: NOW - IMPLICATIONS_CACHE_TTL_MS - 1},
      {tagName: 'b', fetchedAt: NOW - IMPLICATIONS_CACHE_TTL_MS + 1},
    ];
    const {db} = makeDb([], [], implications);

    const deleted = await pruneImplicationCache(db as unknown as Database, NOW);

    expect(deleted).toBe(1);
    expect(implications.map(r => r.tagName)).toEqual(['b']);
  });

  it('gives 0 without the table', async () => {
    expect(await pruneImplicationCache(null, NOW)).toBe(0);
  });
});
