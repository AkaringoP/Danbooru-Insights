import {describe, expect, it} from 'vitest';
import {
  MONTHLY_REPORT_FROM,
  MonthlyReportFormatError,
  buildMonthlyReportUrl,
  defaultReportTo,
  mergeMonthlyCounts,
  monthKeysBetween,
  monthPostsQuery,
  parseMonthlyReport,
  splitReportRange,
  trimMonthlyCounts,
  utcDateString,
  utcDayOf,
  utcMonthStartOf,
} from '../src/core/monthly-report';

describe('monthPostsQuery', () => {
  it('searches the UTC month with explicit instants, end excluded', () => {
    expect(monthPostsQuery('touhou', '2024-02-01')).toBe(
      'touhou date:2024-02-01T00:00:00Z...2024-03-01T00:00:00Z',
    );
    expect(monthPostsQuery('a', '2023-12-01')).toBe(
      'a date:2023-12-01T00:00:00Z...2024-01-01T00:00:00Z',
    );
  });
});

describe('utcMonthStartOf', () => {
  it('is the UTC month of the instant', () => {
    expect(utcMonthStartOf('2024-04-01T05:00:00+09:00')).toBe('2024-03-01');
    expect(utcMonthStartOf('2024-02-29T20:00:00-08:00')).toBe('2024-03-01');
    expect(utcMonthStartOf('not a date')).toBeNull();
  });
});

describe('utcDayOf', () => {
  it('is the UTC day of the instant, whatever offset it carries', () => {
    // Danbooru gives created_at in the viewer's account time zone.
    expect(utcDayOf('2005-07-25T20:30:00-04:00')).toBe('2005-07-26');
    expect(utcDayOf('2005-07-26T05:00:00+09:00')).toBe('2005-07-25');
    expect(utcDayOf(Date.UTC(2026, 10, 13, 23, 59))).toBe('2026-11-13');
    expect(utcDayOf('not a date')).toBeNull();
  });
});

describe('defaultReportTo', () => {
  it('is two days past the UTC date', () => {
    expect(defaultReportTo(new Date('2026-11-30T23:59:00Z'))).toBe(
      '2026-12-02',
    );
  });
});

describe('monthKeysBetween', () => {
  it('lists every month of the range, both ends included', () => {
    expect(monthKeysBetween('2025-11-01', '2026-02-15')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthKeysBetween('2026-03-01', '2026-03-31')).toEqual(['2026-03']);
    expect(monthKeysBetween('2026-04-01', '2026-03-01')).toEqual([]);
  });
});

describe('splitReportRange', () => {
  it('halves a range at the first day of its middle month', () => {
    // 2005-01 .. 2026-11 is 263 months: 131 before the split, 132 from it.
    expect(splitReportRange('2005-01-01', '2026-11-15', 12)).toBe('2015-12-01');
    expect(splitReportRange('2020-01-01', '2021-12-31', 12)).toBe('2021-01-01');
  });

  it('will not cut a piece below the minimum', () => {
    // 23 months: the halves would be 11 and 12.
    expect(splitReportRange('2020-01-01', '2021-11-30', 12)).toBeNull();
    expect(splitReportRange('2026-11-01', '2026-11-15', 1)).toBeNull();
  });
});

/** The search params of a built URL, decoded. */
function paramsOf(url: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(url.split('?')[1]));
}

describe('buildMonthlyReportUrl', () => {
  it('asks for the whole history by month, deleted posts included', () => {
    const now = new Date('2026-11-13T10:00:00Z');
    const url = buildMonthlyReportUrl('touhou', {}, now);

    expect(url.startsWith('/reports/posts.json?')).toBe(true);
    expect(paramsOf(url)).toEqual({
      'search[tags]': 'touhou status:any',
      'search[period]': 'month',
      'search[from]': MONTHLY_REPORT_FROM,
      // `to` counts only up to 00:00 of its day, so it reaches past today.
      'search[to]': '2026-11-15',
    });
  });

  it('takes the default `to` from the UTC date, not the local one', () => {
    // 23:30 UTC on the 31st is already the 1st in UTC+9.
    const now = new Date('2026-12-31T23:30:00Z');
    expect(paramsOf(buildMonthlyReportUrl('a', {}, now))['search[to]']).toBe(
      '2027-01-02',
    );
  });

  it('uses the range it is given', () => {
    const url = buildMonthlyReportUrl('fate/grand_order', {
      from: '2015-01-01',
      to: '2016-07-01',
    });
    expect(paramsOf(url)).toMatchObject({
      'search[tags]': 'fate/grand_order status:any',
      'search[from]': '2015-01-01',
      'search[to]': '2016-07-01',
    });
  });

  it('encodes tags that carry URL syntax', () => {
    const url = buildMonthlyReportUrl('k-on! & co.?');
    expect(paramsOf(url)['search[tags]']).toBe('k-on! & co.? status:any');
    expect(url).not.toContain('& co');
  });
});

describe('utcDateString', () => {
  it('is the UTC calendar date', () => {
    expect(utcDateString(new Date('2026-03-01T00:30:00+09:00'))).toBe(
      '2026-02-28',
    );
  });
});

describe('parseMonthlyReport', () => {
  it('reads newest-first rows into posts per month', () => {
    const counts = parseMonthlyReport([
      {date: '2026-11-01', posts: 4},
      {date: '2026-10-01', posts: 0},
      {date: '2026-09-01', posts: 12},
    ]);
    expect([...counts]).toEqual([
      ['2026-11', 4],
      ['2026-10', 0],
      ['2026-09', 12],
    ]);
  });

  it('accepts a timestamp in `date` and ignores other columns', () => {
    const counts = parseMonthlyReport([
      {date: '2026-11-01T00:00:00.000Z', posts: 3, uploaders: 2},
    ]);
    expect(counts.get('2026-11')).toBe(3);
  });

  it('gives an empty map for an empty reply', () => {
    expect(parseMonthlyReport([]).size).toBe(0);
  });

  it.each([
    ['an error object', {success: false, message: 'timeout'}],
    ['an HTML page', '<!DOCTYPE html>'],
    ['null', null],
  ])('fails on %s instead of a list', (_label, body) => {
    expect(() => parseMonthlyReport(body)).toThrow(MonthlyReportFormatError);
  });

  it.each([
    ['no date', {posts: 3}],
    ['an undated string', {date: 'November', posts: 3}],
    ['month 13', {date: '2026-13-01', posts: 3}],
    ['a string count', {date: '2026-11-01', posts: '3'}],
    ['a negative count', {date: '2026-11-01', posts: -1}],
    ['a fractional count', {date: '2026-11-01', posts: 1.5}],
    ['no row at all', null],
  ])('fails on a row with %s rather than dropping its month', (_l, row) => {
    expect(() =>
      parseMonthlyReport([{date: '2026-10-01', posts: 1}, row]),
    ).toThrow(MonthlyReportFormatError);
  });
});

describe('mergeMonthlyCounts', () => {
  it('adds up the month a split range reports partly from each side', () => {
    // A range split at 2015-06-15: June comes back from both halves.
    const first = new Map([
      ['2015-05', 10],
      ['2015-06', 4],
    ]);
    const second = new Map([
      ['2015-06', 6],
      ['2015-07', 9],
    ]);
    expect([...mergeMonthlyCounts([first, second])]).toEqual([
      ['2015-05', 10],
      ['2015-06', 10],
      ['2015-07', 9],
    ]);
  });

  it('leaves the parts untouched and handles none', () => {
    const part = new Map([['2020-01', 1]]);
    mergeMonthlyCounts([part, part]);
    expect(part.get('2020-01')).toBe(1);
    expect(mergeMonthlyCounts([]).size).toBe(0);
  });
});

describe('trimMonthlyCounts', () => {
  const now = new Date('2026-11-13T10:00:00Z');

  it('drops the leading empty months and the future buckets, keeps gaps', () => {
    const counts = new Map([
      ['2026-12', 0], // the `to` margin reaching past this month
      ['2026-11', 2],
      ['2026-10', 0],
      ['2026-09', 5],
      ['2026-08', 0], // before the first post
      ['2026-07', 0],
    ]);
    expect(trimMonthlyCounts(counts, now)).toEqual([
      {date: '2026-09-01', count: 5, cumulative: 5},
      {date: '2026-10-01', count: 0, cumulative: 5},
      {date: '2026-11-01', count: 2, cumulative: 7},
    ]);
  });

  it('keeps the empty months up to the last one asked for', () => {
    const counts = new Map([
      ['2026-11', 0],
      ['2026-10', 0],
      ['2026-09', 1],
    ]);
    expect(trimMonthlyCounts(counts, now).map(e => e.date)).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ]);
  });

  it('fills a month missing from the reply with 0, across a year end', () => {
    const counts = new Map([
      ['2025-11', 3],
      ['2026-02', 1],
    ]);
    expect(trimMonthlyCounts(counts, now)).toEqual([
      {date: '2025-11-01', count: 3, cumulative: 3},
      {date: '2025-12-01', count: 0, cumulative: 3},
      {date: '2026-01-01', count: 0, cumulative: 3},
      {date: '2026-02-01', count: 1, cumulative: 4},
    ]);
  });

  it('does not invent months past the last one asked for', () => {
    // A layer-2 part that ends in 2016 stays in 2016.
    const counts = new Map([
      ['2016-05', 2],
      ['2016-06', 0],
    ]);
    expect(trimMonthlyCounts(counts, now).map(e => e.date)).toEqual([
      '2016-05-01',
      '2016-06-01',
    ]);
  });

  it('treats the month by UTC: the 1st in UTC+9 is still last month', () => {
    // 2026-12-01 05:00 in UTC+9 is 2026-11-30 20:00 UTC.
    const lateNovember = new Date('2026-11-30T20:00:00Z');
    const counts = new Map([
      ['2026-11', 1],
      ['2026-12', 0],
    ]);
    expect(trimMonthlyCounts(counts, lateNovember).map(e => e.date)).toEqual([
      '2026-11-01',
    ]);
  });

  it('gives an empty history for a tag without posts or an empty reply', () => {
    expect(trimMonthlyCounts(new Map([['2026-11', 0]]), now)).toEqual([]);
    expect(trimMonthlyCounts(new Map(), now)).toEqual([]);
  });

  it('turns a parsed and merged reply into the chart history end to end', () => {
    const halves = [
      parseMonthlyReport([
        {date: '2015-06-01', posts: 4},
        {date: '2015-05-01', posts: 0},
      ]),
      parseMonthlyReport([
        {date: '2026-12-01', posts: 0},
        {date: '2015-07-01', posts: 1},
        {date: '2015-06-01', posts: 6},
      ]),
    ];
    const history = trimMonthlyCounts(mergeMonthlyCounts(halves), now);
    expect(history[0]).toEqual({date: '2015-06-01', count: 10, cumulative: 10});
    expect(history[1]).toEqual({date: '2015-07-01', count: 1, cumulative: 11});
    // The future 2026-12 bucket is dropped, and nothing is filled between
    // July 2015 and it: the history ends at the last month left.
    expect(history.at(-1)?.date).toBe('2015-07-01');
  });
});
