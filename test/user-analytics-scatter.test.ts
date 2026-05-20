import {describe, it, expect} from 'vitest';
import {
  buildPostsUrlForThreshold,
  getEligibleYThresholds,
  niceStepForCount,
  type ScatterScale,
} from '../src/apps/user-analytics-scatter';

const baseScale = (overrides: Partial<ScatterScale> = {}): ScatterScale => ({
  minDate: 0,
  maxDate: 0,
  maxVal: 100,
  timeRange: 1,
  padL: 40,
  padT: 60,
  drawW: 600,
  drawH: 200,
  mode: 'score',
  stepY: 50,
  ...overrides,
});

describe('buildPostsUrlForThreshold', () => {
  it('uses score field for score mode', () => {
    expect(buildPostsUrlForThreshold('alice', 'score', 100)).toBe(
      `/posts?tags=${encodeURIComponent('user:alice score:>=100')}`,
    );
  });

  it('uses gentags (not tagcount) for tags mode', () => {
    const url = buildPostsUrlForThreshold('bob', 'tags', 25);
    expect(url).toContain(encodeURIComponent('gentags:>=25'));
    expect(url).not.toContain('tagcount');
  });

  it('handles empty userName without throwing', () => {
    expect(() => buildPostsUrlForThreshold('', 'score', 50)).not.toThrow();
    expect(buildPostsUrlForThreshold('', 'score', 50)).toBe(
      `/posts?tags=${encodeURIComponent('user: score:>=50')}`,
    );
  });

  it('encodes special characters in userName', () => {
    const url = buildPostsUrlForThreshold('a b', 'score', 1);
    expect(url).toContain('a%20b');
  });
});

describe('getEligibleYThresholds', () => {
  it('Score mode: excludes 0 and topmost', () => {
    expect(
      getEligibleYThresholds(
        baseScale({mode: 'score', maxVal: 500, stepY: 100}),
      ),
    ).toEqual([100, 200, 300, 400]);
  });

  it('Tags mode: excludes 0 and topmost (10 not in step sequence)', () => {
    expect(
      getEligibleYThresholds(baseScale({mode: 'tags', maxVal: 125, stepY: 25})),
    ).toEqual([25, 50, 75, 100]);
  });

  it('Tags mode: excludes 10 even when in step sequence', () => {
    expect(
      getEligibleYThresholds(baseScale({mode: 'tags', maxVal: 50, stepY: 10})),
    ).toEqual([20, 30, 40]);
  });

  it('returns empty when only the top label exists', () => {
    expect(
      getEligibleYThresholds(
        baseScale({mode: 'score', maxVal: 100, stepY: 100}),
      ),
    ).toEqual([]);
  });

  it('returns empty for degenerate scale (maxVal=0)', () => {
    expect(getEligibleYThresholds(baseScale({maxVal: 0, stepY: 50}))).toEqual(
      [],
    );
  });

  it('Score mode at 10 is NOT excluded (only tags mode reserves 10)', () => {
    expect(
      getEligibleYThresholds(baseScale({mode: 'score', maxVal: 50, stepY: 10})),
    ).toEqual([10, 20, 30, 40]);
  });
});

describe('niceStepForCount (Score-mode adaptive stepY)', () => {
  // Targets ~6 sections — actual count varies 5-8 because "nice" steps
  // (1, 2, 2.5, 5, 10 × 10^N) don't divide every maxVal evenly. The point
  // is consistent grid density across score ranges, not exactly 6 every time.
  it('returns 5 for maxVal=30 (target 6 sections)', () => {
    expect(niceStepForCount(30, 6)).toBe(5);
  });

  it('returns 50 for maxVal=300 (the reported user case)', () => {
    expect(niceStepForCount(300, 6)).toBe(50);
  });

  it('returns 100 for maxVal=500', () => {
    expect(niceStepForCount(500, 6)).toBe(100);
  });

  it('returns 100 for maxVal=600 (exact target match)', () => {
    expect(niceStepForCount(600, 6)).toBe(100);
  });

  it('returns 200 for maxVal=1000', () => {
    expect(niceStepForCount(1000, 6)).toBe(200);
  });

  it('returns 500 for maxVal=3000', () => {
    expect(niceStepForCount(3000, 6)).toBe(500);
  });

  it('returns 2000 for maxVal=10000', () => {
    expect(niceStepForCount(10000, 6)).toBe(2000);
  });

  it('uses 2.5 multiplier only when base >= 10 (integer-axis safety)', () => {
    // maxVal=200, raw=33.33, base=10 → ratio=3.33 → closest to 2.5 (mult)
    // → stepY=25. 2.5 is allowed because 2.5 × 10 = 25 is an integer.
    expect(niceStepForCount(200, 6)).toBe(25);
  });

  it('skips 2.5 multiplier when base < 10', () => {
    // maxVal=15, raw=2.5 → exp=0, base=1, ratio=2.5
    // niceMults excludes 2.5 → closest of [1,2,5,10] to 2.5 is 2.
    expect(niceStepForCount(15, 6)).toBe(2);
  });

  it('returns 1 for zero/negative inputs (defensive)', () => {
    expect(niceStepForCount(0, 6)).toBe(1);
    expect(niceStepForCount(-100, 6)).toBe(1);
    expect(niceStepForCount(100, 0)).toBe(1);
  });

  it('uses default targetSections=6 when omitted', () => {
    expect(niceStepForCount(300)).toBe(50);
  });
});
