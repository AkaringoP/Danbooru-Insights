import {describe, it, expect, vi} from 'vitest';

// Shim stack mirrors tag-analytics-pure.test.ts: silence heavy deps so the
// module can load without pulling d3 / rate-limiter / DB internals.
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe('parseImplicationsResponse', () => {
  it('marks every chunk tag as top-level when response is empty', async () => {
    const {parseImplicationsResponse} =
      await import('../src/apps/tag-analytics-data');
    const result = parseImplicationsResponse(['alpha', 'beta', 'gamma'], []);
    expect(result.get('alpha')).toBe(true);
    expect(result.get('beta')).toBe(true);
    expect(result.get('gamma')).toBe(true);
  });

  it('marks tags appearing as antecedent_name as NOT top-level', async () => {
    const {parseImplicationsResponse} =
      await import('../src/apps/tag-analytics-data');
    const imps = [
      {antecedent_name: 'beta', consequent_name: 'beta_parent'},
      {antecedent_name: 'gamma', consequent_name: 'gamma_parent'},
    ];
    const result = parseImplicationsResponse(['alpha', 'beta', 'gamma'], imps);
    expect(result.get('alpha')).toBe(true);
    expect(result.get('beta')).toBe(false);
    expect(result.get('gamma')).toBe(false);
  });

  it('ignores implication entries whose antecedent is not in the chunk', async () => {
    const {parseImplicationsResponse} =
      await import('../src/apps/tag-analytics-data');
    // A chunk of ['alpha'] should not be affected by an implication about 'beta'.
    const imps = [{antecedent_name: 'beta', consequent_name: 'beta_parent'}];
    const result = parseImplicationsResponse(['alpha'], imps);
    expect(result.size).toBe(1);
    expect(result.get('alpha')).toBe(true);
  });

  it('handles non-array response as empty (all top-level)', async () => {
    const {parseImplicationsResponse} =
      await import('../src/apps/tag-analytics-data');
    const result = parseImplicationsResponse(['alpha'], {error: 'not found'});
    expect(result.get('alpha')).toBe(true);
  });

  it('handles implication entries missing antecedent_name gracefully', async () => {
    const {parseImplicationsResponse} =
      await import('../src/apps/tag-analytics-data');
    const imps = [
      {consequent_name: 'orphan_consequent'},
      {antecedent_name: 'beta'},
    ];
    const result = parseImplicationsResponse(['alpha', 'beta'], imps);
    expect(result.get('alpha')).toBe(true);
    expect(result.get('beta')).toBe(false);
  });

  it('returns empty map for empty chunk', async () => {
    const {parseImplicationsResponse} =
      await import('../src/apps/tag-analytics-data');
    const result = parseImplicationsResponse([], []);
    expect(result.size).toBe(0);
  });
});

describe('isImplicationCacheValid', () => {
  const NOW = 1_700_000_000_000;

  it('accepts a freshly-written entry', async () => {
    const {isImplicationCacheValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isImplicationCacheValid(NOW - 1000, NOW)).toBe(true);
  });

  it('accepts an entry within 180 days', async () => {
    const {isImplicationCacheValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isImplicationCacheValid(NOW - 179 * DAY_MS, NOW)).toBe(true);
  });

  it('rejects an entry older than 180 days', async () => {
    const {isImplicationCacheValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isImplicationCacheValid(NOW - 181 * DAY_MS, NOW)).toBe(false);
  });

  it('rejects a future-dated fetchedAt (clock skew defense)', async () => {
    const {isImplicationCacheValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isImplicationCacheValid(NOW + 1000, NOW)).toBe(false);
  });
});

describe('IMPLICATIONS cache constants', () => {
  it('exposes a 180-day TTL', async () => {
    const {IMPLICATIONS_CACHE_TTL_MS} =
      await import('../src/apps/tag-analytics-data');
    expect(IMPLICATIONS_CACHE_TTL_MS).toBe(180 * DAY_MS);
  });

  it('exposes a non-trivial chunk size for URL-length safety', async () => {
    const {IMPLICATIONS_BATCH_CHUNK_SIZE} =
      await import('../src/apps/tag-analytics-data');
    // Must comfortably cover the 20-candidate case without spilling.
    expect(IMPLICATIONS_BATCH_CHUNK_SIZE).toBeGreaterThanOrEqual(20);
  });
});

describe('resetTopLevelSessionCache', () => {
  it('is callable (side-effect only; covered via integration)', async () => {
    const {resetTopLevelSessionCache} =
      await import('../src/apps/tag-analytics-data');
    expect(() => resetTopLevelSessionCache()).not.toThrow();
  });
});
