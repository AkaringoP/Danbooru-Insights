import {describe, it, expect} from 'vitest';
import {
  buildPostsUrlForThreshold,
  getEligibleYThresholds,
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
