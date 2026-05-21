/**
 * Unit tests for the `swrStats` helper (T-42 / v9.6.0 partial-sync count
 * refresh).
 *
 * Critical behaviour gated here:
 *   - Without maxAgeMs (legacy callers): always return cached + schedule
 *     a background revalidate when a cache row exists.
 *   - With maxAgeMs and age < threshold: return cached, NO revalidate
 *     (the new behaviour that saves API calls per dashboard open for
 *     status_dist / rating_dist).
 *   - With maxAgeMs and age >= threshold: return cached + revalidate.
 *   - Cache miss: blocking fresh fetch regardless of maxAgeMs.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {swrStats} from '../src/apps/user-analytics-data';

function makeDataManager(
  getStatsImpl: (
    key: string,
    uid: number,
    maxAgeMs?: number,
  ) => Promise<unknown>,
) {
  return {
    getStats: vi.fn(getStatsImpl),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('swrStats — no uploaderId (uid=0)', () => {
  it('always runs freshFetch when uploaderId is 0 (no cache key)', async () => {
    const fresh = vi.fn(async () => ({rows: 'fresh-data'}));
    const dm = makeDataManager(async () => null);
    const result = await swrStats(dm, 'k', 0, fresh, 'label');
    expect(result.data).toEqual({rows: 'fresh-data'});
    expect(result.startRevalidate).toBeUndefined();
    expect(fresh).toHaveBeenCalledOnce();
    expect(dm.getStats).not.toHaveBeenCalled();
  });
});

describe('swrStats — legacy mode (no maxAgeMs)', () => {
  it('returns cached + startRevalidate on cache hit', async () => {
    const fresh = vi.fn(async () => ({rows: 'fresh'}));
    const dm = makeDataManager(async () => ({rows: 'cached'}));
    const result = await swrStats(dm, 'k', 42, fresh, 'label');
    expect(result.data).toEqual({rows: 'cached'});
    expect(result.startRevalidate).toBeDefined();
    expect(fresh).not.toHaveBeenCalled();
    // The single read is via the no-maxAgeMs path
    expect(dm.getStats).toHaveBeenCalledExactlyOnceWith('k', 42);
  });

  it('blocks on freshFetch when cache misses', async () => {
    const fresh = vi.fn(async () => ({rows: 'new'}));
    const dm = makeDataManager(async () => null);
    const result = await swrStats(dm, 'k', 42, fresh, 'label');
    expect(result.data).toEqual({rows: 'new'});
    expect(result.startRevalidate).toBeUndefined();
    expect(fresh).toHaveBeenCalledOnce();
  });

  it('startRevalidate returns null when fresh JSON equals cached', async () => {
    const fresh = vi.fn(async () => ({rows: 'cached'}));
    const dm = makeDataManager(async () => ({rows: 'cached'}));
    const result = await swrStats(dm, 'k', 42, fresh, 'label');
    const revalidated = await result.startRevalidate!();
    expect(revalidated).toBeNull();
  });

  it('startRevalidate returns fresh data when it differs from cached', async () => {
    const fresh = vi.fn(async () => ({rows: 'fresh'}));
    const dm = makeDataManager(async () => ({rows: 'stale'}));
    const result = await swrStats(dm, 'k', 42, fresh, 'label');
    const revalidated = await result.startRevalidate!();
    expect(revalidated).toEqual({rows: 'fresh'});
  });
});

describe('swrStats — TTL gate (with maxAgeMs)', () => {
  it('fresh cache (age < TTL): returns data, NO revalidate', async () => {
    const fresh = vi.fn(async () => ({rows: 'never-fetched'}));
    // First call (with maxAgeMs) succeeds — record is fresh.
    const dm = makeDataManager(async (_key, _uid, maxAgeMs) => {
      if (maxAgeMs !== undefined) return {rows: 'fresh-cached'};
      return null;
    });
    const result = await swrStats(
      dm,
      'status_dist',
      42,
      fresh,
      'label',
      600_000,
    );
    expect(result.data).toEqual({rows: 'fresh-cached'});
    expect(result.startRevalidate).toBeUndefined();
    expect(fresh).not.toHaveBeenCalled();
    // Only the TTL-gated read happens; no second fallback read.
    expect(dm.getStats).toHaveBeenCalledExactlyOnceWith(
      'status_dist',
      42,
      600_000,
    );
  });

  it('stale cache (age >= TTL but row exists): returns cached + revalidate', async () => {
    const fresh = vi.fn(async () => ({rows: 'fresh'}));
    // First call with TTL → null (stale). Second call without TTL → cached row.
    const dm = makeDataManager(async (_key, _uid, maxAgeMs) => {
      if (maxAgeMs !== undefined) return null;
      return {rows: 'stale-cached'};
    });
    const result = await swrStats(
      dm,
      'status_dist',
      42,
      fresh,
      'label',
      600_000,
    );
    expect(result.data).toEqual({rows: 'stale-cached'});
    expect(result.startRevalidate).toBeDefined();
    expect(fresh).not.toHaveBeenCalled();
    // Both reads happened
    expect(dm.getStats).toHaveBeenCalledTimes(2);
  });

  it('cache miss with TTL: blocking freshFetch (no revalidate, no cached return)', async () => {
    const fresh = vi.fn(async () => ({rows: 'first-fetch'}));
    const dm = makeDataManager(async () => null);
    const result = await swrStats(
      dm,
      'status_dist',
      42,
      fresh,
      'label',
      600_000,
    );
    expect(result.data).toEqual({rows: 'first-fetch'});
    expect(result.startRevalidate).toBeUndefined();
    expect(fresh).toHaveBeenCalledOnce();
  });
});
