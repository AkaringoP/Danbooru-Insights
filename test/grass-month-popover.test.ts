// @vitest-environment jsdom

import {describe, it, expect, vi, afterEach} from 'vitest';
import {
  hideGrassMonthPopover,
  isGrassMonthPopoverHidePending,
  keepGrassMonthPopoverOpen,
  momFragment,
  scheduleHideGrassMonthPopover,
  showGrassMonthPopover,
  sparklineSvg,
  yearTrendSvg,
} from '../src/ui/grass-month-popover';
import type {MonthStats} from '../src/types';

/** MonthStats stub carrying only the fields the sparkline reads. */
function stats(overrides: Partial<MonthStats> = {}): MonthStats {
  return {
    year: 2026,
    month: 6,
    metric: 'uploads',
    total: 0,
    activeDays: 0,
    denominatorDays: 31,
    activeRatio: 0,
    busiest: null,
    average: 0,
    momPct: null,
    momIsNew: false,
    empty: false,
    series: [],
    yearSeries: [],
    ...overrides,
  };
}

/** Count of <rect> elements in the returned markup. */
function barCount(svg: string): number {
  return (svg.match(/<rect/g) ?? []).length;
}

describe('sparklineSvg', () => {
  it('draws one bar per day that has activity', () => {
    const svg = sparklineSvg(stats({series: [3, 0, 5, 0, 1]}));
    // Zero days are left blank rather than drawn at zero height.
    expect(barCount(svg)).toBe(3);
    expect(svg).toContain('<svg');
  });

  it('marks the busiest day so it matches the "Busiest" row', () => {
    const svg = sparklineSvg(
      stats({
        series: [1, 9, 2],
        busiest: {date: '2026-07-02', count: 9},
      }),
    );
    expect(barCount(svg)).toBe(3);
    expect((svg.match(/di-gmp-spark-peak/g) ?? []).length).toBe(1);
    // The peak class belongs to the 2nd bar, not the first one drawn.
    const peakIndex = svg.indexOf('di-gmp-spark-peak');
    const firstRect = svg.indexOf('<rect');
    expect(peakIndex).toBeGreaterThan(firstRect);
  });

  it("scales heights to the month's own peak", () => {
    const svg = sparklineSvg(stats({series: [10, 5]}));
    const heights = [...svg.matchAll(/height="([\d.]+)"/g)]
      .map(m => parseFloat(m[1]))
      // The first height match is the <svg> box itself.
      .slice(1);
    expect(heights).toHaveLength(2);
    expect(heights[0]).toBeGreaterThan(heights[1]);
    // Normalised to the peak: the tallest bar fills the box.
    expect(heights[0]).toBe(30);
  });

  it('keeps a tiny day visible against the baseline', () => {
    // 1 of 1000 would round to a sub-pixel sliver and vanish.
    const svg = sparklineSvg(stats({series: [1000, 1]}));
    const heights = [...svg.matchAll(/height="([\d.]+)"/g)]
      .map(m => parseFloat(m[1]))
      .slice(1);
    expect(heights[1]).toBeGreaterThanOrEqual(1.5);
  });

  it('draws nothing for a future month', () => {
    expect(sparklineSvg(stats({series: []}))).toBe('');
  });

  it('draws nothing when every day is zero', () => {
    // A month can be all-zero yet still have a full-length series; without
    // this guard the peak would be 0 and every bar a divide-by-zero NaN.
    const svg = sparklineSvg(stats({series: [0, 0, 0]}));
    expect(svg).toBe('');
  });

  it('produces no NaN coordinates', () => {
    const svg = sparklineSvg(
      stats({series: [0, 7, 0, 2], busiest: {date: '2026-07-02', count: 7}}),
    );
    expect(svg).not.toContain('NaN');
  });
});

describe('momFragment', () => {
  it("names December as January's predecessor", () => {
    // month - 1 reached index -1 here and rendered a bare "vs ".
    const html = momFragment(stats({month: 0, momPct: -51}));
    expect(html).toContain('vs December');
    expect(html).toContain('51%');
    expect(html).toContain('▼');
  });

  it('names the in-year predecessor for every other month', () => {
    expect(momFragment(stats({month: 6, momPct: 23}))).toContain('vs June');
    expect(momFragment(stats({month: 11, momPct: 5}))).toContain('vs November');
  });

  it('shows "new" instead of a percentage when the previous month was empty', () => {
    const html = momFragment(stats({month: 0, momIsNew: true}));
    expect(html).toContain('new');
    expect(html).not.toContain('vs');
  });

  it('renders nothing when there is no delta to show', () => {
    expect(momFragment(stats({month: 0, momPct: null}))).toBe('');
  });
});

describe('yearTrendSvg', () => {
  const ringCount = (svg: string) =>
    (svg.match(/di-gmp-trend-now/g) ?? []).length;
  const dotCount = (svg: string) =>
    (svg.match(/di-gmp-trend-dot/g) ?? []).length;

  it('draws a line through every month with a vertex on each', () => {
    const svg = yearTrendSvg(
      stats({month: 2, yearSeries: [10, 20, 30, 40], momPct: null}),
    );
    expect(svg).toContain('<polyline');
    expect(dotCount(svg)).toBe(4);
    // Exactly one month is emphasised.
    expect(ringCount(svg)).toBe(1);
  });

  it('spreads months evenly and inverts the value axis', () => {
    // Two months, peak 100: the taller one sits at the top inset, the half
    // -height one halfway down the 22px inner band.
    const svg = yearTrendSvg(stats({month: 0, yearSeries: [50, 100]}));
    expect(svg).toContain('points="4.0,15.0 92.0,4.0"');
  });

  it('centres a lone month instead of pinning it to the left edge', () => {
    const svg = yearTrendSvg(stats({month: 0, yearSeries: [7]}));
    expect(svg).toContain('points="48.0,4.0"');
  });

  it('tints the marker with the same colour as the percentage text', () => {
    const up = yearTrendSvg(stats({month: 1, yearSeries: [5, 9], momPct: 27}));
    expect(up).toContain('di-gmp-trend-up');
    expect(up).not.toContain('di-gmp-trend-down');

    const down = yearTrendSvg(
      stats({month: 1, yearSeries: [9, 5], momPct: -51}),
    );
    expect(down).toContain('di-gmp-trend-down');
    expect(down).not.toContain('di-gmp-trend-up');
  });

  it('treats a "new" month as an increase', () => {
    const svg = yearTrendSvg(
      stats({month: 1, yearSeries: [0, 9], momIsNew: true}),
    );
    expect(svg).toContain('di-gmp-trend-up');
  });

  it('falls back to a neutral marker with no comparison', () => {
    // January before its December lookup resolves.
    const svg = yearTrendSvg(
      stats({month: 0, yearSeries: [9, 4], momPct: null}),
    );
    expect(svg).toContain('di-gmp-trend-current');
    expect(svg).not.toContain('di-gmp-trend-up');
    expect(svg).not.toContain('di-gmp-trend-down');
  });

  it('marks a hovered month that has no activity, down on the baseline', () => {
    // The line passes through zero; "you are here" must still be visible.
    const svg = yearTrendSvg(stats({month: 1, yearSeries: [10, 0, 8]}));
    expect(ringCount(svg)).toBe(1);
    // Baseline = top inset + inner height. r pins the solid marker's size —
    // its hollow predecessor was r=3 with a 2px stroke (8px visually), and
    // the solid version is ~10% smaller at 7.2px.
    expect(svg).toContain('cy="26.0" r="3.6"');
  });

  it('omits the marker when the hovered month is outside the drawn span', () => {
    // Hovering December of the current year, where only July has elapsed.
    const svg = yearTrendSvg(stats({month: 11, yearSeries: [5, 9]}));
    expect(svg).toContain('<polyline');
    expect(ringCount(svg)).toBe(0);
  });

  it('draws nothing for a year with no activity', () => {
    expect(yearTrendSvg(stats({yearSeries: []}))).toBe('');
    expect(yearTrendSvg(stats({month: 0, yearSeries: [0, 0]}))).toBe('');
  });

  it('produces no NaN coordinates', () => {
    const svg = yearTrendSvg(stats({month: 3, yearSeries: [0, 5, 0, 9, 2]}));
    expect(svg).not.toContain('NaN');
  });
});

describe('isGrassMonthPopoverHidePending', () => {
  afterEach(() => {
    hideGrassMonthPopover();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function open(): void {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    showGrassMonthPopover({
      anchor,
      stats: stats({total: 5, series: [5], yearSeries: [5]}),
      themeKey: 'light',
    });
  }

  it('is false while the popover is simply open', () => {
    open();
    expect(isGrassMonthPopoverHidePending()).toBe(false);
  });

  it('is true through both dismissal phases — the linger and the fade', () => {
    vi.useFakeTimers();
    open();

    scheduleHideGrassMonthPopover();
    // Linger: still fully visible, but already on its way out. This is the
    // window a naive isVisible() check reads as "safe to re-show".
    expect(isGrassMonthPopoverHidePending()).toBe(true);

    // Cross into the fade (HIDE_GRACE_MS = 400).
    vi.advanceTimersByTime(400);
    expect(
      document.getElementById('danbooru-grass-month-popover'),
    ).not.toBeNull();
    expect(isGrassMonthPopoverHidePending()).toBe(true);

    // FADE_MS = 200 later the node is gone.
    vi.advanceTimersByTime(200);
    expect(document.getElementById('danbooru-grass-month-popover')).toBeNull();
    expect(isGrassMonthPopoverHidePending()).toBe(false);
  });

  it('goes back to false when the cursor returns and cancels the dismissal', () => {
    vi.useFakeTimers();
    open();
    scheduleHideGrassMonthPopover();
    expect(isGrassMonthPopoverHidePending()).toBe(true);

    keepGrassMonthPopoverOpen();
    expect(isGrassMonthPopoverHidePending()).toBe(false);
    // And the popover really does survive the window it would have died in.
    vi.advanceTimersByTime(1000);
    expect(
      document.getElementById('danbooru-grass-month-popover'),
    ).not.toBeNull();
  });
});
