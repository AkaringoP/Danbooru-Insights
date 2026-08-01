// @vitest-environment jsdom

import {describe, it, expect} from 'vitest';
import {momFragment, sparklineSvg} from '../src/ui/grass-month-popover';
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
