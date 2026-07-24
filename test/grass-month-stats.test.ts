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
