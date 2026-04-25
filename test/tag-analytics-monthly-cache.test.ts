import {describe, it, expect, vi} from 'vitest';

// Same shim stack as tag-analytics-pure.test.ts: silence heavy deps so the
// module can load inside the test runner.
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

// Reference "now" anchored mid-month to avoid boundary flakiness: 2026-06-15 UTC.
const NOW = Date.UTC(2026, 5, 15);

describe('computeMonthsDistance', () => {
  it('returns 0 for the current month', async () => {
    const {computeMonthsDistance} =
      await import('../src/apps/tag-analytics-data');
    expect(computeMonthsDistance('2026-06', new Date(NOW))).toBe(0);
  });

  it('returns 1 for the previous month', async () => {
    const {computeMonthsDistance} =
      await import('../src/apps/tag-analytics-data');
    expect(computeMonthsDistance('2026-05', new Date(NOW))).toBe(1);
  });

  it('counts months across a year boundary', async () => {
    const {computeMonthsDistance} =
      await import('../src/apps/tag-analytics-data');
    expect(computeMonthsDistance('2025-12', new Date(NOW))).toBe(6);
  });

  it('returns 12 for exactly one year ago', async () => {
    const {computeMonthsDistance} =
      await import('../src/apps/tag-analytics-data');
    expect(computeMonthsDistance('2025-06', new Date(NOW))).toBe(12);
  });

  it('returns 252 for 2005-06 (full history span)', async () => {
    const {computeMonthsDistance} =
      await import('../src/apps/tag-analytics-data');
    expect(computeMonthsDistance('2005-06', new Date(NOW))).toBe(252);
  });
});

describe('isMonthlyCountValid', () => {
  it('returns false for the current month (always refetch)', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    // Even freshly fetched: current month is always stale to match Delta sync.
    expect(isMonthlyCountValid('2026-06', NOW - 1000, NOW)).toBe(false);
  });

  it('returns false for the previous month (always refetch)', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2026-05', NOW - 1000, NOW)).toBe(false);
  });

  // 2-12 months → 7d TTL
  it('accepts a 2-month-old entry within 7 days', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2026-04', NOW - 6 * DAY_MS, NOW)).toBe(true);
  });

  it('rejects a 2-month-old entry older than 7 days', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2026-04', NOW - 8 * DAY_MS, NOW)).toBe(false);
  });

  it('accepts a 12-month-old entry within 7 days', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2025-06', NOW - 6 * DAY_MS, NOW)).toBe(true);
  });

  // 13-36 months → 30d TTL
  it('rejects a 13-month-old entry under the 7d rule (belongs to 30d bucket now)', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    // 13 months falls into the 30d bucket: 20d old is valid there.
    expect(isMonthlyCountValid('2025-05', NOW - 20 * DAY_MS, NOW)).toBe(true);
  });

  it('rejects a 13-month-old entry older than 30 days', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2025-05', NOW - 31 * DAY_MS, NOW)).toBe(false);
  });

  it('accepts a 36-month-old entry within 30 days', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2023-06', NOW - 29 * DAY_MS, NOW)).toBe(true);
  });

  // 37+ months → 180d TTL
  it('accepts a 37-month-old entry within 180 days', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2023-05', NOW - 100 * DAY_MS, NOW)).toBe(true);
  });

  it('rejects a 37-month-old entry older than 180 days', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2023-05', NOW - 181 * DAY_MS, NOW)).toBe(false);
  });

  it('treats future-dated fetchedAt as invalid', async () => {
    const {isMonthlyCountValid} =
      await import('../src/apps/tag-analytics-data');
    expect(isMonthlyCountValid('2025-06', NOW + 1000, NOW)).toBe(false);
  });
});

describe('MONTHLY_CACHE constants', () => {
  it('exposes the 2% drift threshold', async () => {
    const {MONTHLY_CACHE_DRIFT_THRESHOLD} =
      await import('../src/apps/tag-analytics-data');
    expect(MONTHLY_CACHE_DRIFT_THRESHOLD).toBeCloseTo(0.02);
  });

  it('exposes the 90-day forced rescan interval', async () => {
    const {MONTHLY_CACHE_FULL_RESCAN_MS} =
      await import('../src/apps/tag-analytics-data');
    expect(MONTHLY_CACHE_FULL_RESCAN_MS).toBe(90 * DAY_MS);
  });
});
