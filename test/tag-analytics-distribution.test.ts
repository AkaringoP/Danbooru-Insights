import {describe, it, expect, vi} from 'vitest';
import type {DanbooruRelatedTag} from '../src/types';

// Same shim stack as the other tag-analytics-data tests.
vi.mock('d3', () => ({}));
vi.mock('../src/config', () => ({
  CONFIG: {
    RATE_LIMITER: {},
    MAX_OPTIMIZED_POSTS: 1200,
    CACHE_EXPIRY_MS: 86400000,
  },
  DAY_MS: 24 * 60 * 60 * 1000,
}));
vi.mock('../src/core/analytics-data-manager', () => ({
  AnalyticsDataManager: vi.fn(),
}));
vi.mock('../src/core/rate-limiter', () => ({RateLimitedFetch: vi.fn()}));
vi.mock('../src/utils', () => ({
  isTopLevelTag: vi.fn(),
  escapeHtml: vi.fn((s: string) => s),
}));

function mkTag(name: string, frequency: number): DanbooruRelatedTag {
  return {
    tag: {name, category: 3},
    frequency,
  };
}

describe('buildDistributionApprox', () => {
  it('returns an empty list for no candidates', async () => {
    const {buildDistributionApprox} =
      await import('../src/apps/tag-analytics-data');
    expect(buildDistributionApprox([], 1000)).toEqual([]);
  });

  it('computes approx count as floor(frequency × totalCount)', async () => {
    const {buildDistributionApprox} =
      await import('../src/apps/tag-analytics-data');
    const slices = buildDistributionApprox(
      [mkTag('alpha', 0.5), mkTag('beta', 0.3)],
      10000,
    );
    expect(slices[0].key).toBe('alpha');
    expect(slices[0].count).toBe(5000);
    expect(slices[1].key).toBe('beta');
    expect(slices[1].count).toBe(3000);
  });

  it('caps to top 10 and sorts descending by frequency (unsorted input)', async () => {
    const {buildDistributionApprox, DISTRIBUTION_TOP_N} =
      await import('../src/apps/tag-analytics-data');
    // Intentionally unsorted input: i=14 has the highest frequency.
    const many: DanbooruRelatedTag[] = Array.from({length: 15}, (_, i) =>
      mkTag(`tag_${i}`, 0.01 * (i + 1)),
    );
    const slices = buildDistributionApprox(many, 1000);
    expect(slices.length).toBeLessThanOrEqual(DISTRIBUTION_TOP_N + 1);
    // Function must internally sort before slicing: the highest (0.15)
    // wins regardless of input order.
    expect(slices[0].frequency).toBeCloseTo(0.15);
    expect(slices[0].key).toBe('tag_14');
  });

  it('emits an "Others" slice when residual frequency exceeds 0.5%', async () => {
    const {buildDistributionApprox} =
      await import('../src/apps/tag-analytics-data');
    // Three slices summing to 0.9 → ≈10% residual → Others shown.
    const slices = buildDistributionApprox(
      [mkTag('a', 0.5), mkTag('b', 0.3), mkTag('c', 0.1)],
      1000,
    );
    const others = slices.find(s => s.isOther);
    expect(others).toBeDefined();
    expect(others?.key).toBe('others');
    // Floor of 1000 × residual — residual is ≈0.1 with float wiggle, so
    // accept 99 or 100 (both within rounding error of 10%).
    expect(others?.count).toBeGreaterThanOrEqual(99);
    expect(others?.count).toBeLessThanOrEqual(100);
  });

  it('omits the "Others" slice when residual falls below 0.5%', async () => {
    const {buildDistributionApprox} =
      await import('../src/apps/tag-analytics-data');
    // Two slices summing to 0.997 → 0.3% residual → no Others.
    const slices = buildDistributionApprox(
      [mkTag('a', 0.6), mkTag('b', 0.397)],
      1000,
    );
    expect(slices.find(s => s.isOther)).toBeUndefined();
  });

  it('stops adding individual slices once cumulative frequency exceeds 95%', async () => {
    const {buildDistributionApprox, DISTRIBUTION_CUTOFF_FREQ} =
      await import('../src/apps/tag-analytics-data');
    // a+b = 0.98 > 0.95, so break fires after b. c/d must be excluded.
    // (Threshold is strict `>`; exact 0.95 would allow one more iteration.)
    const slices = buildDistributionApprox(
      [mkTag('a', 0.6), mkTag('b', 0.38), mkTag('c', 0.01), mkTag('d', 0.01)],
      1000,
    );
    const names = slices.filter(s => !s.isOther).map(s => s.key);
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).not.toContain('c');
    expect(names).not.toContain('d');
    expect(DISTRIBUTION_CUTOFF_FREQ).toBeCloseTo(0.95);
  });

  it('prefers nested related_tag.frequency over top-level frequency', async () => {
    const {buildDistributionApprox} =
      await import('../src/apps/tag-analytics-data');
    const nested: DanbooruRelatedTag = {
      tag: {name: 'alpha', category: 3},
      frequency: 0.9, // Outer (ignored)
      related_tag: {frequency: 0.1},
    };
    const slices = buildDistributionApprox([nested], 1000);
    expect(slices[0].frequency).toBeCloseTo(0.1);
    expect(slices[0].count).toBe(100);
  });

  it('clamps negative totalCount to zero counts (defensive)', async () => {
    const {buildDistributionApprox} =
      await import('../src/apps/tag-analytics-data');
    const slices = buildDistributionApprox([mkTag('a', 0.5)], -100);
    expect(slices[0].count).toBe(0);
  });

  it('replaces underscores with spaces in the display name', async () => {
    const {buildDistributionApprox} =
      await import('../src/apps/tag-analytics-data');
    const slices = buildDistributionApprox([mkTag('hatsune_miku', 0.5)], 1000);
    expect(slices[0].name).toBe('hatsune miku');
    // key preserves the raw tag for URL construction
    expect(slices[0].key).toBe('hatsune_miku');
  });
});

describe('distributionToCountMap', () => {
  it('collapses slices into a tag → count record', async () => {
    const {distributionToCountMap} =
      await import('../src/apps/tag-analytics-data');
    const map = distributionToCountMap([
      {name: 'a', key: 'a', frequency: 0.5, count: 500},
      {name: 'b', key: 'b', frequency: 0.3, count: 300},
      {
        name: 'Others',
        key: 'others',
        frequency: 0.2,
        count: 200,
        isOther: true,
      },
    ]);
    expect(map).toEqual({a: 500, b: 300, others: 200});
  });

  it('returns an empty object for no slices', async () => {
    const {distributionToCountMap} =
      await import('../src/apps/tag-analytics-data');
    expect(distributionToCountMap([])).toEqual({});
  });
});

describe('DISTRIBUTION constants', () => {
  it('top-N is sized for the pie-chart budget', async () => {
    const {DISTRIBUTION_TOP_N} = await import('../src/apps/tag-analytics-data');
    expect(DISTRIBUTION_TOP_N).toBe(10);
  });

  it('Others minimum frequency is 0.5%', async () => {
    const {DISTRIBUTION_OTHERS_MIN_FREQ} =
      await import('../src/apps/tag-analytics-data');
    expect(DISTRIBUTION_OTHERS_MIN_FREQ).toBeCloseTo(0.005);
  });
});
