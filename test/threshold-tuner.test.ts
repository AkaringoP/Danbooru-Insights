import {describe, it, expect, beforeEach} from 'vitest';
import {
  computeAutoThresholds,
  simulateDistribution,
  wouldTuningImprove,
  detectSaturation,
  dismissSuggestion,
  wasDismissed,
  _resetDismissedForTests,
  mostRecentBoundary,
  MIN_ACTIVE_DAYS,
} from '../src/core/threshold-tuner';
import type {Threshold4} from '../src/types';

describe('computeAutoThresholds', () => {
  it('returns null when sample size < minSamples', () => {
    const samples = Array(13).fill(1);
    expect(computeAutoThresholds(samples)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(computeAutoThresholds([])).toBeNull();
  });

  it('accepts exactly minSamples', () => {
    const samples = Array(MIN_ACTIVE_DAYS).fill(5);
    expect(computeAutoThresholds(samples)).not.toBeNull();
  });

  it('produces [1, P40, P70, P90] for evenly distributed counts', () => {
    const samples = Array.from({length: 100}, (_, i) => i + 1); // 1..100
    expect(computeAutoThresholds(samples)).toEqual([1, 40, 70, 90]);
  });

  it('keeps L1=1 even when all counts are higher', () => {
    const samples = Array(50).fill(5);
    // P40=P70=P90=5 → strict-increasing: [1, 5, 6, 7]
    expect(computeAutoThresholds(samples)).toEqual([1, 5, 6, 7]);
  });

  it('falls back to [1,2,3,4] for low-activity users (all counts = 1)', () => {
    const samples = Array(MIN_ACTIVE_DAYS).fill(1);
    expect(computeAutoThresholds(samples)).toEqual([1, 2, 3, 4]);
  });

  it('handles long-tail outliers without inflating L4 (P90 misses single outlier)', () => {
    // 29 ones + 1 thousand: sorted = [1,1,...,1, 1000]. P90 lands at index 26 = 1.
    const samples = [...Array(29).fill(1), 1000];
    expect(computeAutoThresholds(samples)).toEqual([1, 2, 3, 4]);
  });

  it('produces meaningful spread for a power user with variance', () => {
    // 5 days at 50, 3 at 100, 3 at 200, 3 at 500, 3 at 1000 (17 samples).
    const samples = [
      ...Array(5).fill(50),
      ...Array(3).fill(100),
      ...Array(3).fill(200),
      ...Array(3).fill(500),
      ...Array(3).fill(1000),
    ];
    // sorted indices: P40=ceil(6.8)-1=6 → 100, P70=ceil(11.9)-1=11 → 500, P90=ceil(15.3)-1=15 → 1000
    expect(computeAutoThresholds(samples)).toEqual([1, 100, 500, 1000]);
  });
});

describe('simulateDistribution', () => {
  it('returns all zeros for empty counts', () => {
    expect(simulateDistribution([], [1, 5, 10, 20])).toEqual({
      empty: 0,
      l1: 0,
      l2: 0,
      l3: 0,
      l4: 0,
    });
  });

  it('counts zero-activity days as empty', () => {
    expect(simulateDistribution([0, 0, 0], [1, 5, 10, 20])).toEqual({
      empty: 3,
      l1: 0,
      l2: 0,
      l3: 0,
      l4: 0,
    });
  });

  it('places counts at threshold boundaries into the higher bucket', () => {
    // c < t[i] → previous level. c=1 → l1 (>=t1, <t2). c=5 → l2. c=10 → l3. c=20 → l4.
    expect(simulateDistribution([1, 5, 10, 20], [1, 5, 10, 20])).toEqual({
      empty: 0,
      l1: 1,
      l2: 1,
      l3: 1,
      l4: 1,
    });
  });

  it('classifies all high counts as L4', () => {
    expect(simulateDistribution(Array(10).fill(100), [1, 5, 10, 20])).toEqual({
      empty: 0,
      l1: 0,
      l2: 0,
      l3: 0,
      l4: 10,
    });
  });
});

describe('wouldTuningImprove', () => {
  it('returns false when activity is flat (single value, can never spread)', () => {
    const counts = Array(180).fill(100);
    const current: Threshold4 = [1, 10, 25, 50];
    const proposed = computeAutoThresholds(counts)!;
    expect(wouldTuningImprove(counts, current, proposed)).toBe(false);
  });

  it('returns false for low-activity users (all 1s)', () => {
    const counts = Array(30).fill(1);
    const current: Threshold4 = [1, 10, 25, 50];
    const proposed = computeAutoThresholds(counts)!;
    expect(wouldTuningImprove(counts, current, proposed)).toBe(false);
  });

  it('returns true for power user with variance under default thresholds', () => {
    const counts = [
      ...Array(5).fill(50),
      ...Array(3).fill(100),
      ...Array(3).fill(200),
      ...Array(3).fill(500),
      ...Array(3).fill(1000),
    ];
    const current: Threshold4 = [1, 10, 25, 50];
    const proposed = computeAutoThresholds(counts)!;
    // Before: all 17 in L4 (maxRatio=1.0). After: max bucket ≤ 6/17 ≈ 0.35 → improvement ≥ 0.65.
    expect(wouldTuningImprove(counts, current, proposed)).toBe(true);
  });
});

describe('detectSaturation', () => {
  it('flags high saturation when ≥90% of counts are at or above L4', () => {
    const counts = [...Array(9).fill(100), 5];
    expect(detectSaturation(counts, [1, 10, 25, 50])).toBe('high');
  });

  it('does not flag at 89% saturation (under threshold)', () => {
    const counts = [...Array(89).fill(100), ...Array(11).fill(5)];
    expect(detectSaturation(counts, [1, 10, 25, 50])).toBe(null);
  });

  it('flags low saturation when ≥90% of counts fall in L1 bucket', () => {
    const counts = [...Array(9).fill(1), 50];
    expect(detectSaturation(counts, [1, 10, 25, 50])).toBe('low');
  });

  it('returns null for a balanced distribution', () => {
    const counts = [1, 5, 12, 30, 100, 2, 8, 20, 60, 200];
    expect(detectSaturation(counts, [1, 10, 25, 50])).toBe(null);
  });

  it('returns null for empty counts', () => {
    expect(detectSaturation([], [1, 10, 25, 50])).toBe(null);
  });
});

describe('mostRecentBoundary', () => {
  // Helper: format YYYY-MM-DD for assertions (timezone-stable since the
  // helper builds dates with explicit year/month/day in local time).
  const ymd = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;

  describe('monthly', () => {
    it('returns 1st of the same month for mid-month', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 4, 15), 'monthly'))).toBe(
        '2026-05-01',
      );
    });
    it('returns the same date when called on the 1st itself', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 4, 1), 'monthly'))).toBe(
        '2026-05-01',
      );
    });
  });

  describe('quarterly', () => {
    it('Jan-Mar → Jan 1', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 1, 15), 'quarterly'))).toBe(
        '2026-01-01',
      );
    });
    it('Apr-Jun → Apr 1', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 4, 15), 'quarterly'))).toBe(
        '2026-04-01',
      );
    });
    it('Jul-Sep → Jul 1', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 8, 30), 'quarterly'))).toBe(
        '2026-07-01',
      );
    });
    it('Oct-Dec → Oct 1', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 11, 31), 'quarterly'))).toBe(
        '2026-10-01',
      );
    });
  });

  describe('semiannual', () => {
    it('Jan-Jun → Jan 1', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 5, 30), 'semiannual'))).toBe(
        '2026-01-01',
      );
    });
    it('Jul → Jul 1', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 6, 1), 'semiannual'))).toBe(
        '2026-07-01',
      );
    });
    it('Dec → Jul 1', () => {
      expect(
        ymd(mostRecentBoundary(new Date(2026, 11, 31), 'semiannual')),
      ).toBe('2026-07-01');
    });
  });

  describe('yearly', () => {
    it('any month → Jan 1 of that year', () => {
      expect(ymd(mostRecentBoundary(new Date(2026, 7, 4), 'yearly'))).toBe(
        '2026-01-01',
      );
      expect(ymd(mostRecentBoundary(new Date(2026, 0, 1), 'yearly'))).toBe(
        '2026-01-01',
      );
    });
  });

  it('returns midnight (start of day)', () => {
    const b = mostRecentBoundary(new Date(2026, 4, 15, 23, 59, 59), 'monthly');
    expect(b.getHours()).toBe(0);
    expect(b.getMinutes()).toBe(0);
    expect(b.getSeconds()).toBe(0);
  });
});

describe('session dismiss memory', () => {
  beforeEach(() => {
    _resetDismissedForTests();
  });

  it('returns false before dismissal', () => {
    expect(wasDismissed('user_42')).toBe(false);
  });

  it('returns true after dismissal', () => {
    dismissSuggestion('user_42');
    expect(wasDismissed('user_42')).toBe(true);
  });

  it('isolates dismissals by userId', () => {
    dismissSuggestion('user_42');
    expect(wasDismissed('user_43')).toBe(false);
  });
});
