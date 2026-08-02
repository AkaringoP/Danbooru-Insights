import {describe, it, expect} from 'vitest';
import {
  computeMonthStats,
  metricLabel,
  monthLongName,
} from '../src/core/grass-month-stats';

// Fixed reference "now": July 15, 2026 (month index 6).
const TODAY = new Date(2026, 6, 15);

describe('computeMonthStats — core stats', () => {
  it('past month: total / activeDays / busiest / average / ratio', () => {
    const daily = {
      '2026-06-01': 5,
      '2026-06-10': 10,
      '2026-06-15': 3,
      '2026-06-20': 0, // zero day does not count as active
    };
    const s = computeMonthStats(daily, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.total).toBe(18);
    expect(s.activeDays).toBe(3);
    expect(s.denominatorDays).toBe(30); // June has 30 days (past month)
    expect(s.busiest).toEqual({date: '2026-06-10', count: 10});
    expect(s.average).toBe(0.6); // 18 / 30
    expect(s.activeRatio).toBeCloseTo(3 / 30);
    expect(s.empty).toBe(false);
    expect(s.metric).toBe('uploads');
  });

  it('average rounds to one decimal', () => {
    const daily = {'2026-04-01': 10}; // April past → denom 30
    const s = computeMonthStats(daily, 2026, 3, {
      today: TODAY,
      metric: 'notes',
    });
    expect(s.average).toBe(0.3); // 10 / 30 = 0.333… → 0.3
  });

  it('in-progress month uses days elapsed as the denominator', () => {
    const daily = {'2026-07-05': 4, '2026-07-14': 8};
    const s = computeMonthStats(daily, 2026, 6, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.denominatorDays).toBe(15); // today is the 15th
    expect(s.total).toBe(12);
    expect(s.activeDays).toBe(2);
    expect(s.average).toBe(0.8); // 12 / 15
  });

  it('empty month: zeros, null busiest, not new', () => {
    const s = computeMonthStats({}, 2026, 3, {
      today: TODAY,
      metric: 'approvals',
    });
    expect(s.empty).toBe(true);
    expect(s.total).toBe(0);
    expect(s.activeDays).toBe(0);
    expect(s.busiest).toBeNull();
    expect(s.average).toBe(0);
    expect(s.activeRatio).toBe(0);
    expect(s.momPct).toBeNull();
    expect(s.momIsNew).toBe(false);
  });

  it('busiest tie breaks toward the earliest date', () => {
    const daily = {'2026-06-03': 9, '2026-06-20': 9, '2026-06-10': 4};
    const s = computeMonthStats(daily, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.busiest).toEqual({date: '2026-06-03', count: 9});
  });

  it('leap-year February has 29 denominator days', () => {
    const s = computeMonthStats({'2024-02-10': 1}, 2024, 1, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.denominatorDays).toBe(29);
  });

  it('future month: denominator 0, average/ratio 0', () => {
    const s = computeMonthStats({}, 2026, 8, {today: TODAY, metric: 'uploads'});
    expect(s.denominatorDays).toBe(0);
    expect(s.average).toBe(0);
    expect(s.activeRatio).toBe(0);
  });

  it('clamps the denominator so activeDays never exceeds it (TZ boundary)', () => {
    // today is the 15th, but a user ahead of UTC has 16 dated keys already.
    const daily: Record<string, number> = {};
    for (let d = 1; d <= 16; d++) {
      daily[`2026-07-${String(d).padStart(2, '0')}`] = 1;
    }
    const s = computeMonthStats(daily, 2026, 6, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.activeDays).toBe(16);
    expect(s.denominatorDays).toBe(16); // clamped up from the 15 elapsed days
    expect(s.activeRatio).toBe(1);
  });
});

describe('computeMonthStats — month-over-month', () => {
  it('positive delta vs previous month', () => {
    const daily = {'2026-05-10': 10, '2026-06-10': 18};
    const s = computeMonthStats(daily, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.momPct).toBe(80); // (18-10)/10
    expect(s.momIsNew).toBe(false);
  });

  it('negative delta vs previous month', () => {
    const daily = {'2026-05-10': 20, '2026-06-10': 15};
    const s = computeMonthStats(daily, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.momPct).toBe(-25); // (15-20)/20
  });

  it('previous total 0 but current activity → momIsNew, no percent', () => {
    const daily = {'2026-06-10': 7}; // May absent → prevTotal 0
    const s = computeMonthStats(daily, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.momPct).toBeNull();
    expect(s.momIsNew).toBe(true);
  });

  it('previous and current both 0 → momPct null, not new', () => {
    const s = computeMonthStats({}, 2026, 5, {today: TODAY, metric: 'uploads'});
    expect(s.momPct).toBeNull();
    expect(s.momIsNew).toBe(false);
  });

  it('January never shows MoM (previous month is out of the loaded year)', () => {
    const daily = {'2026-01-10': 12}; // December 2025 not in this map
    const s = computeMonthStats(daily, 2026, 0, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.momPct).toBeNull();
    expect(s.momIsNew).toBe(false);
    expect(s.total).toBe(12);
  });
});

describe('computeMonthStats — sparkline series', () => {
  it('past month: one slot per calendar day, indexed from the 1st', () => {
    const daily = {'2026-06-01': 5, '2026-06-10': 10, '2026-06-30': 2};
    const s = computeMonthStats(daily, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.series).toHaveLength(30); // June
    expect(s.series[0]).toBe(5); // the 1st
    expect(s.series[9]).toBe(10); // the 10th
    expect(s.series[29]).toBe(2); // the 30th
    expect(s.series[4]).toBe(0); // a day with no entry
  });

  it('in-progress month stops at today instead of trailing fake zeroes', () => {
    // TODAY is July 15 — drawing all 31 slots would end the chart with a
    // fortnight of zeroes that only mean "hasn't happened yet".
    const daily = {'2026-07-01': 4, '2026-07-15': 9};
    const s = computeMonthStats(daily, 2026, 6, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.series).toHaveLength(15);
    expect(s.series[14]).toBe(9);
  });

  it('keeps a day whose data runs ahead of the local date', () => {
    // Daily keys lean UTC, so a user behind UTC can already have tomorrow's
    // bucket; the series must not clip a day that has activity.
    const daily = {'2026-07-16': 3};
    const s = computeMonthStats(daily, 2026, 6, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.series).toHaveLength(16);
    expect(s.series[15]).toBe(3);
  });

  it('sizes February by the actual year (leap vs common)', () => {
    const leap = computeMonthStats({'2024-02-29': 1}, 2024, 1, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(leap.series).toHaveLength(29);
    expect(leap.series[28]).toBe(1);

    const common = computeMonthStats({'2025-02-10': 1}, 2025, 1, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(common.series).toHaveLength(28);
  });

  it('future month has nothing to draw', () => {
    const s = computeMonthStats({}, 2026, 11, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.series).toEqual([]);
  });

  it('empty past month still yields a full row of zeroes', () => {
    // `empty` gates the popover, not the series: the shape stays honest.
    const s = computeMonthStats({}, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.series).toHaveLength(30);
    expect(s.series.every(v => v === 0)).toBe(true);
  });

  it('ignores days belonging to other months', () => {
    const daily = {'2026-06-10': 10, '2026-07-10': 99, '2025-06-10': 77};
    const s = computeMonthStats(daily, 2026, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.series[9]).toBe(10);
    expect(s.series.reduce((a, b) => a + b, 0)).toBe(10);
  });
});

describe('computeMonthStats — year trend series', () => {
  it('finished year: one total per month, indexed from January', () => {
    const daily = {
      '2025-01-05': 10,
      '2025-01-20': 5,
      '2025-06-01': 7,
      '2025-12-31': 3,
    };
    const s = computeMonthStats(daily, 2025, 5, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.yearSeries).toHaveLength(12);
    expect(s.yearSeries[0]).toBe(15); // January, both days summed
    expect(s.yearSeries[5]).toBe(7);
    expect(s.yearSeries[11]).toBe(3);
    expect(s.yearSeries[2]).toBe(0);
  });

  it('current year stops at the month in progress', () => {
    // TODAY is July 2026 — months after it have not happened.
    const s = computeMonthStats({'2026-07-01': 4}, 2026, 6, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.yearSeries).toHaveLength(7); // Jan..Jul
  });

  it('extends past the current month when a later one has data', () => {
    const s = computeMonthStats({'2026-09-01': 4}, 2026, 6, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.yearSeries).toHaveLength(9);
    expect(s.yearSeries[8]).toBe(4);
  });

  it('ignores other years', () => {
    const daily = {'2026-03-01': 5, '2025-03-01': 99};
    const s = computeMonthStats(daily, 2026, 2, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.yearSeries.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('future year has no trend to draw', () => {
    const s = computeMonthStats({}, 2027, 0, {
      today: TODAY,
      metric: 'uploads',
    });
    expect(s.yearSeries).toEqual([]);
  });
});

describe('label helpers', () => {
  it('metricLabel', () => {
    expect(metricLabel('uploads')).toBe('Uploads');
    expect(metricLabel('approvals')).toBe('Approvals');
    expect(metricLabel('notes')).toBe('Notes');
  });

  it('monthLongName', () => {
    expect(monthLongName(0)).toBe('January');
    expect(monthLongName(5)).toBe('June');
    expect(monthLongName(11)).toBe('December');
    expect(monthLongName(99)).toBe('');
  });
});
