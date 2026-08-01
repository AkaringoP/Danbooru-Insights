/**
 * Tag Cloud cache TTL + forceRefresh tests (v9.6.0 hotfix).
 *
 * Verifies that `getTagCloudData`:
 *  - Returns cached results when the piestats record is younger than the
 *    count-cache TTL (default 10 min).
 *  - Refetches when the record is older than the TTL (the bug we fixed:
 *    pre-v9.6.0 the cache was trust-until-reset, so users kept seeing
 *    unfiltered Lift results indefinitely).
 *  - Bypasses cache entirely when `forceRefresh=true` (the path used by
 *    the SWR revalidate / per-category tab switch).
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AnalyticsDataManager} from '../src/core/analytics-data-manager';
import type {TargetUser} from '../src/types';

vi.mock('../src/core/quota-manager', () => ({
  bulkPutSafe: vi.fn(async () => undefined),
  requestPersistence: vi.fn(async () => false),
  evictOldestNonCurrentUser: vi.fn(async () => null),
}));

function makeUser(): TargetUser {
  return {
    name: 'AkaringoP',
    normalizedName: 'akaringop',
    id: '701499',
    created_at: '2020-01-01T00:00:00Z',
    joinDate: new Date('2020-01-01'),
    level_string: 'Member',
  };
}

const CACHED_ITEMS = [
  {name: '1girl', tagName: '1girl', frequency: 0.83, count: 830},
];

const FRESH_API_RESPONSE = {
  post_count: 1000,
  related_tags: [
    {tag: {name: 'halo', post_count: 450_000}, frequency: 0.22},
    {tag: {name: 'collarbone', post_count: 1_000_000}, frequency: 0.26},
  ],
};

interface PiestatsRecord {
  data: unknown;
  updated_at: string;
}

function makeDb(piestatsRecord: PiestatsRecord | null) {
  const piestatsGet = vi.fn(async () => piestatsRecord);
  const piestatsPut = vi.fn(async () => undefined);
  return {
    piestats: {get: piestatsGet, put: piestatsPut},
    piestatsGet,
    piestatsPut,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeRateLimiter() {
  return {
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FRESH_API_RESPONSE,
    })),
    getRequestCount: vi.fn(() => 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getTagCloudData — cache TTL gate (v9.6.0 hotfix)', () => {
  it('returns cached data when record is within TTL (default 10 min)', async () => {
    const record: PiestatsRecord = {
      data: CACHED_ITEMS,
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min old
    };
    const db = makeDb(record);
    const rl = makeRateLimiter();
    const adm = new AnalyticsDataManager(db, rl);

    // categoryId=1 (Artist) — bypasses global lookups, simpler to assert
    const result = await adm.getTagCloudData(makeUser(), 1);

    expect(result).toEqual(CACHED_ITEMS);
    expect(rl.fetch).not.toHaveBeenCalled();
  });

  it('refetches when record is older than TTL (the v9.6.0 fix path)', async () => {
    const record: PiestatsRecord = {
      data: CACHED_ITEMS,
      // 30 min old — well past the 10-min default TTL. Pre-v9.6.0 this
      // would have served stale data forever.
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    const db = makeDb(record);
    const rl = makeRateLimiter();
    const adm = new AnalyticsDataManager(db, rl);

    const result = await adm.getTagCloudData(makeUser(), 1);

    expect(rl.fetch).toHaveBeenCalledOnce();
    // Returns fresh data, not the stale cached items
    expect(result.map(r => r.tagName)).toContain('halo');
    expect(result.map(r => r.tagName)).not.toContain('1girl');
    // And writes the fresh data back
    expect(db.piestatsPut).toHaveBeenCalled();
  });

  it('bypasses cache when forceRefresh=true (SWR revalidate path)', async () => {
    const record: PiestatsRecord = {
      data: CACHED_ITEMS,
      // 1 min old — well within TTL. Cache would be a hit without force.
      updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
    };
    const db = makeDb(record);
    const rl = makeRateLimiter();
    const adm = new AnalyticsDataManager(db, rl);

    const result = await adm.getTagCloudData(makeUser(), 1, true);

    expect(rl.fetch).toHaveBeenCalledOnce();
    expect(result.map(r => r.tagName)).toContain('halo');
  });

  it('refetches when no cached record exists (initial population)', async () => {
    const db = makeDb(null);
    const rl = makeRateLimiter();
    const adm = new AnalyticsDataManager(db, rl);

    const result = await adm.getTagCloudData(makeUser(), 1);

    expect(rl.fetch).toHaveBeenCalledOnce();
    expect(result.map(r => r.tagName)).toContain('halo');
    expect(db.piestatsPut).toHaveBeenCalled();
  });

  it('honors custom TTL from localStorage', async () => {
    // Set TTL to 60 min via the settings key
    localStorageMock.setItem('di.count_cache_ttl_min', '60');
    const record: PiestatsRecord = {
      data: CACHED_ITEMS,
      // 30 min old — past default 10 min but within custom 60 min.
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    };
    const db = makeDb(record);
    const rl = makeRateLimiter();
    const adm = new AnalyticsDataManager(db, rl);

    const result = await adm.getTagCloudData(makeUser(), 1);

    expect(rl.fetch).not.toHaveBeenCalled();
    expect(result).toEqual(CACHED_ITEMS);
  });
});
