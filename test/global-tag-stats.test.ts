/**
 * Unit tests for the global-tag-stats cache helpers (T-35).
 *
 * Covers: cache hit, cache miss → fetch, TTL expiry, parse failure /
 * malformed payload fallbacks, and the localStorage serialization round-trip
 * for the top-50 map.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  getGlobalTotalPosts,
  getGlobalTopGeneralTags,
  _clearGlobalTagStatsCache,
  applyGeneralTagCloudFilter,
  type TagCloudFilterEntry,
} from '../src/core/global-tag-stats';

function makeRateLimiter(
  fetchImpl: (
    url: string,
  ) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>,
) {
  return {
    fetch: vi.fn(fetchImpl),
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

describe('getGlobalTotalPosts', () => {
  it('fetches from /counts/posts.json?tags=status:any on cache miss', async () => {
    const rl = makeRateLimiter(async url => {
      expect(url).toContain('/counts/posts.json');
      expect(url).toContain('status%3Aany');
      return {
        ok: true,
        status: 200,
        json: async () => ({counts: {posts: 9_876_543}}),
      };
    });

    const total = await getGlobalTotalPosts(rl);
    expect(total).toBe(9_876_543);
    expect(rl.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call without refetching', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 5_000_000}}),
    }));

    await getGlobalTotalPosts(rl);
    await getGlobalTotalPosts(rl);
    expect(rl.fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL expiry', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 1_000_000}}),
    }));

    const realNow = Date.now;
    try {
      await getGlobalTotalPosts(rl);
      // Advance time past 24h TTL
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 25 * 60 * 60 * 1000);
      await getGlobalTotalPosts(rl);
      expect(rl.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.spyOn(Date, 'now').mockRestore();
    }
  });

  it('treats a 0 result as cache-miss (refetches next call)', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 0}}),
    }));

    const first = await getGlobalTotalPosts(rl);
    expect(first).toBe(0);
    await getGlobalTotalPosts(rl);
    expect(rl.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns 0 (no cache write) on HTTP error', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    const result = await getGlobalTotalPosts(rl);
    expect(result).toBe(0);
    expect(localStorage.getItem('di.cache.global_total')).toBeNull();
  });

  it('ignores cache when stored JSON is malformed', async () => {
    localStorage.setItem('di.cache.global_total', '{not-json');
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 7}}),
    }));
    const result = await getGlobalTotalPosts(rl);
    expect(result).toBe(7);
  });
});

describe('getGlobalTopGeneralTags', () => {
  const SAMPLE_PAYLOAD = {
    related_tags: [
      {tag: {name: '1girl', post_count: 5_500_000, category: 0}, frequency: 1},
      {tag: {name: '1boy', post_count: 3_000_000, category: 0}, frequency: 1},
      {
        tag: {name: 'solo', post_count: 4_000_000, category: 0},
        frequency: 1,
      },
    ],
  };

  it('fetches and returns map keyed by tag name on cache miss', async () => {
    const rl = makeRateLimiter(async url => {
      expect(url).toContain('/related_tag.json');
      expect(url).toContain('search[category]=0');
      expect(url).toContain('search[order]=Frequency');
      expect(url).toContain('limit=50');
      return {ok: true, status: 200, json: async () => SAMPLE_PAYLOAD};
    });

    const map = await getGlobalTopGeneralTags(rl);
    expect(map.size).toBe(3);
    expect(map.get('1girl')).toBe(5_500_000);
    expect(map.get('1boy')).toBe(3_000_000);
    expect(map.get('solo')).toBe(4_000_000);
  });

  it('skips entries with missing name/post_count', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        related_tags: [
          {tag: {name: 'good', post_count: 100}, frequency: 1},
          {tag: {name: 'no_count'}, frequency: 1},
          {tag: {post_count: 50}, frequency: 1},
          {tag: {name: 'zero', post_count: 0}, frequency: 1},
        ],
      }),
    }));
    const map = await getGlobalTopGeneralTags(rl);
    expect(map.size).toBe(1);
    expect(map.get('good')).toBe(100);
  });

  it('returns cached map (round-trips through JSON) on second call', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => SAMPLE_PAYLOAD,
    }));

    await getGlobalTopGeneralTags(rl);
    const second = await getGlobalTopGeneralTags(rl);
    expect(rl.fetch).toHaveBeenCalledTimes(1);
    expect(second.get('1girl')).toBe(5_500_000);
  });

  it('returns empty map on HTTP error (no cache write)', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    const map = await getGlobalTopGeneralTags(rl);
    expect(map.size).toBe(0);
    expect(localStorage.getItem('di.cache.global_top50_general')).toBeNull();
  });

  it('returns empty map when related_tags is missing/non-array', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({related_tags: 'nope'}),
    }));
    const map = await getGlobalTopGeneralTags(rl);
    expect(map.size).toBe(0);
  });

  it('refetches after TTL expiry', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => SAMPLE_PAYLOAD,
    }));

    const realNow = Date.now;
    try {
      await getGlobalTopGeneralTags(rl);
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 25 * 60 * 60 * 1000);
      await getGlobalTopGeneralTags(rl);
      expect(rl.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.spyOn(Date, 'now').mockRestore();
    }
  });
});

describe('applyGeneralTagCloudFilter', () => {
  // Realistic-ish numbers: 1boy is a top-50 global tag (~30% globalRate),
  // gloves is also in top-50 but rarer (~5%). user has 1000 posts total.
  const TOP_GLOBAL = new Map<string, number>([
    ['1boy', 3_000_000],
    ['gloves', 500_000],
    ['simple_background', 2_000_000],
  ]);
  const GLOBAL_TOTAL = 10_000_000;
  const LIFT = 2.0;
  const FLOOR = 3;

  function entry(
    tagName: string,
    userRate: number,
    userTotal = 1000,
  ): TagCloudFilterEntry {
    return {
      tagName,
      frequency: userRate,
      userCount: Math.round(userRate * userTotal),
    };
  }

  it('keeps tags not in the global top-50 unchanged', () => {
    const entries = [entry('niche_specialty_tag', 0.05)];
    const result = applyGeneralTagCloudFilter(
      entries,
      TOP_GLOBAL,
      GLOBAL_TOTAL,
      LIFT,
      FLOOR,
    );
    expect(result).toEqual(entries);
  });

  it('drops top-50 tag whose lift is below threshold', () => {
    // 1boy: userRate 25%, globalRate 30%, lift = 0.83 → drop
    const entries = [entry('1boy', 0.25)];
    const result = applyGeneralTagCloudFilter(
      entries,
      TOP_GLOBAL,
      GLOBAL_TOTAL,
      LIFT,
      FLOOR,
    );
    expect(result).toHaveLength(0);
  });

  it('rescues top-50 tag whose lift >= threshold', () => {
    // gloves: userRate 30%, globalRate 5%, lift = 6.0 → keep
    const entries = [entry('gloves', 0.3)];
    const result = applyGeneralTagCloudFilter(
      entries,
      TOP_GLOBAL,
      GLOBAL_TOTAL,
      LIFT,
      FLOOR,
    );
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('gloves');
  });

  it('rejects rescue when userCount is below floor (small-sample noise)', () => {
    // gloves: userRate 60% but userTotal only 4, so userCount = 2 < floor
    const entries = [entry('gloves', 0.6, 4)];
    const result = applyGeneralTagCloudFilter(
      entries,
      TOP_GLOBAL,
      GLOBAL_TOTAL,
      LIFT,
      FLOOR,
    );
    expect(result).toHaveLength(0);
  });

  it('handles a mix of keep/drop/rescue in one pass', () => {
    const entries = [
      entry('niche_specialty_tag', 0.05), // not in top50 → keep
      entry('1boy', 0.25), // top50, lift 0.83 → drop
      entry('gloves', 0.3), // top50, lift 6.0 → rescue
      entry('simple_background', 0.5), // top50, lift 2.5 → rescue
    ];
    const result = applyGeneralTagCloudFilter(
      entries,
      TOP_GLOBAL,
      GLOBAL_TOTAL,
      LIFT,
      FLOOR,
    );
    expect(result.map(e => e.tagName)).toEqual([
      'niche_specialty_tag',
      'gloves',
      'simple_background',
    ]);
  });

  it('passes everything through when globalTotal is unknown (fetch failure)', () => {
    const entries = [entry('1boy', 0.25), entry('niche', 0.05)];
    const result = applyGeneralTagCloudFilter(
      entries,
      TOP_GLOBAL,
      0,
      LIFT,
      FLOOR,
    );
    expect(result).toEqual(entries);
  });

  it('passes everything through when top-50 map is empty (fetch failure)', () => {
    const entries = [entry('1boy', 0.25), entry('niche', 0.05)];
    const result = applyGeneralTagCloudFilter(
      entries,
      new Map(),
      GLOBAL_TOTAL,
      LIFT,
      FLOOR,
    );
    expect(result).toEqual(entries);
  });

  it('exactly-at-threshold passes (lift === 2.0 with floor=2 case)', () => {
    // gloves: userRate 10%, globalRate 5%, lift = 2.0 → keep (>= threshold)
    const entries = [entry('gloves', 0.1)];
    const result = applyGeneralTagCloudFilter(
      entries,
      TOP_GLOBAL,
      GLOBAL_TOTAL,
      LIFT,
      FLOOR,
    );
    expect(result).toHaveLength(1);
  });
});

describe('_clearGlobalTagStatsCache', () => {
  it('removes both cache keys', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 42}}),
    }));
    await getGlobalTotalPosts(rl);
    expect(localStorage.getItem('di.cache.global_total')).not.toBeNull();

    _clearGlobalTagStatsCache();
    expect(localStorage.getItem('di.cache.global_total')).toBeNull();
    expect(localStorage.getItem('di.cache.global_top50_general')).toBeNull();
  });
});
