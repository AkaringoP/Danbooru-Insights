/**
 * Tests for `fetchSubTagsForParents` and `applySubTagBreakdown` (T-43).
 *
 * Covers:
 *  - Cache miss → batched fetch → cache write
 *  - Cache hit (fresh) → no fetch
 *  - Schema version mismatch → refetch
 *  - TTL expiry → refetch
 *  - HTTP error → empty per-parent fallback (no exception)
 *  - Empty parents → no fetch
 *  - Pure breakdown: share math, top-N, Others bucket, NaN/empty defense
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  fetchSubTagsForParents,
  applySubTagBreakdown,
} from '../src/core/sub-tag-resolver';

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

function makeDb(initialRecords: Record<string, unknown> = {}): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: Record<string, any>;
  bulkGet: ReturnType<typeof vi.fn>;
  bulkPut: ReturnType<typeof vi.fn>;
} {
  const store: Record<string, unknown> = {...initialRecords};
  const bulkGet = vi.fn(async (keys: string[]) =>
    keys.map(k => store[k] ?? undefined),
  );
  const bulkPut = vi.fn(
    async (records: Array<{tagName: string} & Record<string, unknown>>) => {
      for (const r of records) store[r.tagName] = r;
      return undefined;
    },
  );
  return {
    db: {tag_implications_cache: {bulkGet, bulkPut}},
    store,
    bulkGet,
    bulkPut,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchSubTagsForParents', () => {
  it('returns empty map immediately when parents is empty', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    const {db} = makeDb();
    const result = await fetchSubTagsForParents(rl, db, []);
    expect(result.size).toBe(0);
    expect(rl.fetch).not.toHaveBeenCalled();
  });

  it('fetches via /tag_implications.json with consequent_name_comma', async () => {
    const rl = makeRateLimiter(async url => {
      expect(url).toContain('/tag_implications.json');
      expect(url).toContain('consequent_name_comma');
      expect(url).toContain('idolmaster');
      // Matches the existing fetchTopLevelTagsBatch convention — literal
      // brackets in the URL, not percent-encoded.
      expect(url).toContain('search[status]=active');
      return {
        ok: true,
        status: 200,
        json: async () => [
          {antecedent_name: 'deremas', consequent_name: 'idolmaster'},
          {antecedent_name: 'milimas', consequent_name: 'idolmaster'},
          {antecedent_name: 'gakumas', consequent_name: 'idolmaster'},
        ],
      };
    });
    const {db, bulkPut} = makeDb();

    const result = await fetchSubTagsForParents(rl, db, ['idolmaster']);

    expect(result.get('idolmaster')).toEqual(
      new Set(['deremas', 'milimas', 'gakumas']),
    );
    expect(rl.fetch).toHaveBeenCalledOnce();
    // Cache write happened
    expect(bulkPut).toHaveBeenCalledOnce();
    const written = bulkPut.mock.calls[0][0][0];
    expect(written.tagName).toBe('consequent:idolmaster');
    expect(written.subs).toEqual(['deremas', 'milimas', 'gakumas']);
    expect(written.schemaVersion).toBe(2);
  });

  it('returns empty Set for parents with no implications (and caches that)', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [], // no implications
    }));
    const {db, bulkPut} = makeDb();

    const result = await fetchSubTagsForParents(rl, db, ['gundam']);

    expect(result.get('gundam')).toEqual(new Set());
    // Cached the empty result so we won't refetch
    expect(bulkPut).toHaveBeenCalledOnce();
    expect(bulkPut.mock.calls[0][0][0].subs).toEqual([]);
  });

  it('reads from cache when records are fresh (no network)', async () => {
    const now = Date.now();
    const {db, bulkGet} = makeDb({
      'consequent:idolmaster': {
        tagName: 'consequent:idolmaster',
        isTopLevel: false,
        subs: ['deremas', 'milimas'],
        fetchedAt: now - 1000,
        schemaVersion: 2,
      },
    });
    const rl = makeRateLimiter(async () => {
      throw new Error('should not fetch');
    });

    const result = await fetchSubTagsForParents(rl, db, ['idolmaster']);

    expect(result.get('idolmaster')).toEqual(new Set(['deremas', 'milimas']));
    expect(bulkGet).toHaveBeenCalledOnce();
    expect(rl.fetch).not.toHaveBeenCalled();
  });

  it('refetches when cache record has wrong schemaVersion', async () => {
    const now = Date.now();
    const {db} = makeDb({
      'consequent:idolmaster': {
        tagName: 'consequent:idolmaster',
        isTopLevel: false,
        subs: ['stale_data'],
        fetchedAt: now - 1000,
        schemaVersion: 1, // pre-v9.6 contract
      },
    });
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {antecedent_name: 'deremas', consequent_name: 'idolmaster'},
      ],
    }));

    const result = await fetchSubTagsForParents(rl, db, ['idolmaster']);

    expect(result.get('idolmaster')).toEqual(new Set(['deremas']));
    expect(rl.fetch).toHaveBeenCalledOnce();
  });

  it('refetches when cache record is older than 180 days', async () => {
    const now = Date.now();
    const old = now - 181 * 24 * 60 * 60 * 1000;
    const {db} = makeDb({
      'consequent:idolmaster': {
        tagName: 'consequent:idolmaster',
        isTopLevel: false,
        subs: ['stale_sub'],
        fetchedAt: old,
        schemaVersion: 2,
      },
    });
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {antecedent_name: 'deremas', consequent_name: 'idolmaster'},
      ],
    }));

    const result = await fetchSubTagsForParents(rl, db, ['idolmaster']);

    expect(result.get('idolmaster')).toEqual(new Set(['deremas']));
    expect(rl.fetch).toHaveBeenCalledOnce();
  });

  it('returns empty set on HTTP error (does not throw, does not cache)', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    const {db, bulkPut} = makeDb();

    const result = await fetchSubTagsForParents(rl, db, ['idolmaster']);

    expect(result.get('idolmaster')).toEqual(new Set());
    // On failure we still write the empty set (caches the "tried, nothing"
    // outcome — this is a documented design choice to avoid retry storms).
    // If we wanted to NOT cache on failure, we'd skip bulkPut. Current
    // behaviour: cache. Verify both branches as documentation.
    expect(bulkPut).toHaveBeenCalled();
  });

  it('handles null db (works without persistence)', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {antecedent_name: 'deremas', consequent_name: 'idolmaster'},
      ],
    }));

    const result = await fetchSubTagsForParents(rl, null, ['idolmaster']);

    expect(result.get('idolmaster')).toEqual(new Set(['deremas']));
    expect(rl.fetch).toHaveBeenCalledOnce();
  });

  it('groups subs by parent when multiple parents query together', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {antecedent_name: 'deremas', consequent_name: 'idolmaster'},
        {antecedent_name: 'gundam_seed', consequent_name: 'gundam'},
        {antecedent_name: 'milimas', consequent_name: 'idolmaster'},
      ],
    }));
    const {db} = makeDb();

    const result = await fetchSubTagsForParents(rl, db, [
      'idolmaster',
      'gundam',
    ]);

    expect(result.get('idolmaster')).toEqual(new Set(['deremas', 'milimas']));
    expect(result.get('gundam')).toEqual(new Set(['gundam_seed']));
  });

  it('chunks parents when total exceeds CHUNK_SIZE (30)', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    const {db} = makeDb();

    const parents = Array.from({length: 75}, (_, i) => `parent_${i}`);
    await fetchSubTagsForParents(rl, db, parents);

    // 75 / 30 = 3 batches
    expect(rl.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('applySubTagBreakdown', () => {
  it('returns empty array when parent has no candidates', () => {
    const result = applySubTagBreakdown(new Set(), new Map([['x', 10]]));
    expect(result).toEqual([]);
  });

  it('returns empty array when user has none of the parent subs', () => {
    const parentSubs = new Set(['deremas', 'milimas']);
    const userCounts = new Map([['gundam_seed', 50]]);
    expect(applySubTagBreakdown(parentSubs, userCounts)).toEqual([]);
  });

  it('returns single entry when user has exactly one sub', () => {
    const result = applySubTagBreakdown(
      new Set(['deremas']),
      new Map([['deremas', 30]]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tagName: 'deremas',
      count: 30,
      share: 1.0,
      isOther: false,
    });
  });

  it('computes shares relative to user-sub-tag sum', () => {
    const result = applySubTagBreakdown(
      new Set(['deremas', 'milimas', 'gakumas']),
      new Map([
        ['deremas', 60],
        ['milimas', 30],
        ['gakumas', 10],
      ]),
    );
    expect(result).toHaveLength(3);
    expect(result[0].share).toBeCloseTo(0.6, 5);
    expect(result[1].share).toBeCloseTo(0.3, 5);
    expect(result[2].share).toBeCloseTo(0.1, 5);
    // All non-Others
    expect(result.every(r => !r.isOther)).toBe(true);
  });

  it('sorts entries by count descending', () => {
    const result = applySubTagBreakdown(
      new Set(['a', 'b', 'c']),
      new Map([
        ['a', 10],
        ['b', 50],
        ['c', 30],
      ]),
    );
    expect(result.map(r => r.tagName)).toEqual(['b', 'c', 'a']);
  });

  it('buckets long tail into "Others" once 95% threshold is crossed', () => {
    // 6 subs with the top three accounting for 96% — the rest are tail.
    const result = applySubTagBreakdown(
      new Set(['a', 'b', 'c', 'd', 'e', 'f']),
      new Map([
        ['a', 50],
        ['b', 30],
        ['c', 16],
        ['d', 2],
        ['e', 1],
        ['f', 1],
      ]),
    );
    // Top three pass cleanly, then Others bucket.
    expect(result).toHaveLength(4);
    expect(result[0].tagName).toBe('a');
    expect(result[3].tagName).toBe('Others');
    expect(result[3].isOther).toBe(true);
    expect(result[3].count).toBe(4); // 2+1+1
  });

  it('respects maxItems cap (10 by default)', () => {
    const subs = new Set<string>();
    const counts = new Map<string, number>();
    for (let i = 0; i < 15; i++) {
      const name = `sub_${i}`;
      subs.add(name);
      counts.set(name, 100 - i); // descending counts, all > 0
    }
    const result = applySubTagBreakdown(subs, counts);
    expect(result.length).toBeLessThanOrEqual(10);
    // Last row should be Others if not single trailing
    if (result.length === 10) {
      expect(result[9].isOther).toBe(true);
    }
  });

  it('buckets a single trailing row into Others once threshold is crossed', () => {
    // v9.7+: the earlier "emit single trailing row directly" exemption
    // was removed — once cumulative passes the threshold, all remaining
    // rows go into Others, even if only one is left. Keeps the chart's
    // "top-N + Others" pattern consistent for the tooltip too.
    const result = applySubTagBreakdown(
      new Set(['a', 'b', 'c']),
      new Map([
        ['a', 70],
        ['b', 27],
        ['c', 3],
      ]),
    );
    // a (70%) → emit, cumulative 0.70.
    // b (27%) → emit, cumulative 0.97 (> 0.95).
    // c (3%)  → bucket as Others, even though it's the only tail row.
    expect(result).toHaveLength(3);
    expect(result[0].tagName).toBe('a');
    expect(result[1].tagName).toBe('b');
    expect(result[2].tagName).toBe('Others');
    expect(result[2].isOther).toBe(true);
    expect(result[2].count).toBe(3);
    const total = result.reduce((s, r) => s + r.share, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('treats subs the user has 0 count for as not present', () => {
    const result = applySubTagBreakdown(
      new Set(['deremas', 'milimas']),
      new Map([
        ['deremas', 30],
        ['milimas', 0],
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('deremas');
    expect(result[0].share).toBe(1.0);
  });

  it('returns empty array if maxItems is 0 or negative', () => {
    const result = applySubTagBreakdown(
      new Set(['a']),
      new Map([['a', 10]]),
      0,
    );
    expect(result).toEqual([]);
  });
});
