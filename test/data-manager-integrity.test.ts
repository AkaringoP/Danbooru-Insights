/**
 * DataManager data integrity tests.
 *
 * Covers: remote/local count comparison, safe deletion boundaries,
 * year completion cache, 3-day safety buffer, user ID validation,
 * hourly stats delta merge, revalidateCurrentYearCache, and clearCache.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {DataManager} from '../src/core/data-manager';
import type {Metric, TargetUser} from '../src/types';

// ---------------------------------------------------------------------------
// Helpers: Dexie mock factory
// ---------------------------------------------------------------------------

/** Build a chainable Dexie WhereClause / Collection mock backed by `rows`. */
function makeChain(rows: Record<string, unknown>[]) {
  const chain = {
    between: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
    each: vi.fn(async (cb: (row: Record<string, unknown>) => void) => {
      rows.forEach(cb);
    }),
    last: vi.fn(async () => (rows.length > 0 ? rows[rows.length - 1] : null)),
    toArray: vi.fn(async () => [...rows]),
    delete: vi.fn(async () => rows.length),
    primaryKeys: vi.fn(async () => rows.map((_, i) => `key_${i}`)),
    count: vi.fn(async () => rows.length),
  };
  return chain;
}

/** Create a mock Dexie table that delegates `.where()` to a chain. */
function makeTable(rows: Record<string, unknown>[] = []) {
  const chain = makeChain(rows);
  const table = {
    where: vi.fn().mockReturnValue(chain),
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    bulkPut: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => undefined),
    count: vi.fn(async () => rows.length),
    _chain: chain,
    _rows: rows,
  };
  return table;
}

/** Create a full mock db with all tables DataManager touches. */
function makeDb(overrides: Record<string, unknown> = {}) {
  const db: Record<string, unknown> = {
    uploads: makeTable(),
    approvals: makeTable(),
    approvals_detail: makeTable(),
    notes: makeTable(),
    completed_years: makeTable(),
    hourly_stats: makeTable(),
    piestats: makeTable(),
    grass_settings: makeTable(),
    transaction: vi.fn(
      async (_mode: string, _tables: unknown[], cb: () => Promise<void>) => {
        await cb();
      },
    ),
    ...overrides,
  };
  return db;
}

/** Create a mock RateLimitedFetch. */
function makeRateLimiter(
  fetchImpl?: (
    url: string,
  ) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>,
) {
  const defaultFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [],
  });
  return {
    fetch: vi.fn(fetchImpl ?? defaultFetch),
    getRequestCount: vi.fn(() => 0),
  };
}

/** A standard test user. */
function makeUser(overrides: Partial<TargetUser> = {}): TargetUser {
  return {
    name: 'test_user',
    normalizedName: 'test_user',
    id: '42',
    created_at: '2020-01-01T00:00:00Z',
    joinDate: new Date('2020-01-01'),
    level_string: 'Member',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// DataManager reads window.location.origin in the constructor
beforeEach(() => {
  vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// 1. Integrity check — remote vs local count comparison
// ---------------------------------------------------------------------------

describe('getMetricData — integrity check', () => {
  it('triggers full refetch when remote count != local count (past year uploads)', async () => {
    // Arrange: local has 5 uploads, remote says 10
    const localRows = [
      {id: '42_2023-03-15', userId: '42', date: '2023-03-15', count: 5},
    ];
    const uploadsTable = makeTable(localRows);
    const completedYears = makeTable(); // not completed
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 10}}),
        };
      }
      // Main fetch returns empty (no new data)
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);

    // Act
    await dm.getMetricData('uploads', makeUser(), 2023);

    // Assert: deletion was triggered on the uploads table
    expect(uploadsTable._chain.delete).toHaveBeenCalled();
  });

  it('skips integrity check when year is already marked complete', async () => {
    const completedYears = makeTable();
    completedYears.get.mockResolvedValue({id: '42_uploads_2023'} as never);

    const hourlyStats = makeTable();
    const uploadsTable = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter();
    const dm = new DataManager(db, rl as never);

    await dm.getMetricData('uploads', makeUser(), 2023);

    // Remote count should NOT be fetched
    expect(rl.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/counts/posts.json'),
    );
  });

  it('skips integrity check for current year', async () => {
    const currentYear = new Date().getFullYear();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    const dm = new DataManager(db, rl as never);

    await dm.getMetricData('uploads', makeUser(), currentYear);

    // Should not call counts endpoint for current year
    const countCalls = (rl.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: string[]) => c[0].includes('/counts/posts.json'),
    );
    expect(countCalls.length).toBe(0);
  });

  it('skips integrity check for non-uploads metrics (approvals, notes)', async () => {
    const completedYears = makeTable();
    const hourlyStats = makeTable();
    const approvalsTable = makeTable();

    const db = makeDb({
      approvals: approvalsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    const dm = new DataManager(db, rl as never);

    await dm.getMetricData('approvals', makeUser(), 2023);

    const countCalls = (rl.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: string[]) => c[0].includes('/counts/posts.json'),
    );
    expect(countCalls.length).toBe(0);
  });

  it('does not delete data when remote count matches local count', async () => {
    const localRows = [
      {id: '42_2023-06-01', userId: '42', date: '2023-06-01', count: 7},
    ];
    const uploadsTable = makeTable(localRows);
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 7}}),
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser(), 2023);

    // Deletion should NOT have been triggered
    expect(uploadsTable._chain.delete).not.toHaveBeenCalled();
  });

  it('continues gracefully when integrity check network request fails', async () => {
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        throw new Error('Network error');
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);

    // Should not throw — integrity check failure is non-fatal
    await expect(
      dm.getMetricData('uploads', makeUser(), 2023),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. User ID validation during aggregation
// ---------------------------------------------------------------------------

describe('getMetricData — user ID validation', () => {
  it('filters out items with mismatched user IDs during aggregation', async () => {
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const currentYear = new Date().getFullYear();
    // Only return data for the first page request; subsequent pages return empty
    // to avoid duplication from the 5-page parallel batch.
    let pageHit = 0;
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/posts.json')) {
        pageHit++;
        if (pageHit === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {uploader_id: 42, created_at: `${currentYear}-05-10T12:00:00Z`},
              {uploader_id: 99, created_at: `${currentYear}-05-10T13:00:00Z`}, // wrong user
              {uploader_id: 42, created_at: `${currentYear}-05-11T10:00:00Z`},
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    const user = makeUser({id: '42'});

    await dm.getMetricData('uploads', user, currentYear);

    const bulkPutCalls = uploadsTable.bulkPut.mock.calls as unknown[][];
    expect(bulkPutCalls.length).toBeGreaterThan(0);
    const written = bulkPutCalls[0][0] as Array<{date: string; count: number}>;
    const may10 = written.find(r => r.date === `${currentYear}-05-10`);
    const may11 = written.find(r => r.date === `${currentYear}-05-11`);
    // May 10 should have count=1 (not 2), mismatched ID filtered out
    expect(may10?.count).toBe(1);
    expect(may11?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Hourly stats delta merge — no double counting
// ---------------------------------------------------------------------------

describe('getMetricData — hourly stats delta merge', () => {
  it('does not double-count hours for data in the overlap buffer period', async () => {
    const currentYear = new Date().getFullYear();

    // Derive local hours from the same Date parsing the production code uses,
    // so the test is correct regardless of the runner's timezone.
    const overlapTimestamp = `${currentYear}-05-10T12:30:00Z`;
    const newTimestamp = `${currentYear}-05-11T14:00:00Z`;
    const overlapLocalHour = new Date(overlapTimestamp).getHours();
    const newLocalHour = new Date(newTimestamp).getHours();

    // Existing cached data: last entry is May 10
    const localRows = [
      {
        id: `42_${currentYear}-05-10`,
        userId: '42',
        date: `${currentYear}-05-10`,
        count: 3,
      },
    ];
    const uploadsTable = makeTable(localRows);
    const completedYears = makeTable();

    // Existing hourly stats: overlapLocalHour has 3 counts
    const existingHourly = [
      {
        id: `42_uploads_${currentYear}_${String(overlapLocalHour).padStart(2, '0')}`,
        userId: '42',
        metric: 'uploads',
        year: currentYear,
        hour: overlapLocalHour,
        count: 3,
      },
    ];
    const hourlyStats = makeTable(existingHourly);

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    let pageHit = 0;
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/posts.json')) {
        pageHit++;
        if (pageHit === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              // Overlapping: same date as lastEntry — should NOT increment hourly
              {uploader_id: 42, created_at: overlapTimestamp},
              // New data: after lastEntry date — SHOULD increment hourly
              {uploader_id: 42, created_at: newTimestamp},
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser(), currentYear);

    const hourlyPutCalls = hourlyStats.bulkPut.mock.calls as unknown[][];
    expect(hourlyPutCalls.length).toBeGreaterThan(0);
    const hourlyData = hourlyPutCalls[0][0] as Array<{
      hour: number;
      count: number;
    }>;

    const overlapEntry = hourlyData.find(h => h.hour === overlapLocalHour);
    const newEntry = hourlyData.find(h => h.hour === newLocalHour);
    // Overlap hour: loaded 3 from DB, overlap data NOT added → still 3
    expect(overlapEntry?.count).toBe(3);
    // New hour: new data → 1
    expect(newEntry?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Year completion marking
// ---------------------------------------------------------------------------

describe('getMetricData — year completion', () => {
  it('marks past year as complete after successful fetch', async () => {
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    // Return matching remote count so integrity check passes
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 0}}),
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser(), 2023);

    // completed_years.put should have been called
    expect(completedYears.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '42_uploads_2023',
        userId: '42',
        metric: 'uploads',
        year: 2023,
      }),
    );
  });

  it('does NOT mark current year as complete', async () => {
    const currentYear = new Date().getFullYear();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser(), currentYear);

    // completed_years.put should NOT have been called for current year
    const putCalls = completedYears.put.mock.calls;
    const currentYearPut = putCalls.find(
      (c: unknown[]) => (c[0] as {year: number}).year === currentYear,
    );
    expect(currentYearPut).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. 3-day safety buffer
// ---------------------------------------------------------------------------

describe('getMetricData — 3-day safety buffer', () => {
  it('applies 3-day rollback when fetching incrementally for current year', async () => {
    const currentYear = new Date().getFullYear();
    // Cached data up to May 15
    const localRows = [
      {
        id: `42_${currentYear}-05-15`,
        userId: '42',
        date: `${currentYear}-05-15`,
        count: 2,
      },
    ];
    const uploadsTable = makeTable(localRows);
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const fetchedUrls: string[] = [];
    const rl = makeRateLimiter(async (url: string) => {
      fetchedUrls.push(url);
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser(), currentYear);

    // The fetch URL should contain a date 3 days before May 15 = May 12
    const postsFetch = fetchedUrls.find(u => u.includes('/posts.json'));
    expect(postsFetch).toBeDefined();
    expect(postsFetch).toContain(`${currentYear}-05-12`);
  });
});

// ---------------------------------------------------------------------------
// 6. revalidateCurrentYearCache
// ---------------------------------------------------------------------------

describe('revalidateCurrentYearCache', () => {
  beforeEach(() => {
    // Mock localStorage
    const storage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        storage[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
    });
  });

  it('clears stale data when remote count mismatches local count', async () => {
    const year = new Date().getFullYear();
    const localRows = [
      {id: `42_${year}-03-01`, userId: '42', date: `${year}-03-01`, count: 10},
    ];
    const uploadsTable = makeTable(localRows);
    const approvalsTable = makeTable(); // empty — no mismatch
    const completedYears = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      approvals: approvalsTable,
      completed_years: completedYears,
    });

    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json') && url.includes('user:')) {
        // Remote says 20 but local has 10 → mismatch
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 20}}),
        };
      }
      if (url.includes('/counts/posts.json') && url.includes('approver:')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 0}}),
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.revalidateCurrentYearCache('42', 'test_user');

    // Uploads table should have had deletion triggered
    expect(uploadsTable._chain.delete).toHaveBeenCalled();
    // Flag should be set
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'di_cache_v924_migrated_42',
      '1',
    );
  });

  it('sets flag without deleting when counts match', async () => {
    const uploadsTable = makeTable();
    const approvalsTable = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      approvals: approvalsTable,
      completed_years: makeTable(),
    });

    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 0}}),
    }));

    const dm = new DataManager(db, rl as never);
    await dm.revalidateCurrentYearCache('42', 'test_user');

    expect(uploadsTable._chain.delete).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'di_cache_v924_migrated_42',
      '1',
    );
  });

  it('skips entirely when localStorage flag is already set', async () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('1');

    const db = makeDb();
    const rl = makeRateLimiter();
    const dm = new DataManager(db, rl as never);

    await dm.revalidateCurrentYearCache('42', 'test_user');

    // No fetch should happen
    expect(rl.fetch).not.toHaveBeenCalled();
  });

  it('does NOT set flag when network request fails (allows retry)', async () => {
    const db = makeDb();
    const rl = makeRateLimiter(async () => {
      throw new Error('Network error');
    });

    const dm = new DataManager(db, rl as never);
    await dm.revalidateCurrentYearCache('42', 'test_user');

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. clearCache
// ---------------------------------------------------------------------------

describe('clearCache', () => {
  it('deletes entries for the target user from all relevant tables', async () => {
    const tables = [
      'uploads',
      'approvals',
      'approvals_detail',
      'notes',
      'completed_years',
      'hourly_stats',
    ] as const;

    const mockTables: Record<string, ReturnType<typeof makeTable>> = {};
    for (const name of tables) {
      mockTables[name] = makeTable([{id: '42_data', userId: '42'}]);
    }

    const db = makeDb(mockTables);
    const rl = makeRateLimiter();
    const dm = new DataManager(db, rl as never);

    const result = await dm.clearCache('uploads', makeUser());

    expect(result).toBe(true);
    for (const name of tables) {
      expect(mockTables[name].bulkDelete).toHaveBeenCalled();
    }
  });

  it('returns false on database error', async () => {
    const uploadsTable = makeTable();
    uploadsTable.where.mockImplementation(() => {
      throw new Error('DB error');
    });

    const db = makeDb({uploads: uploadsTable});
    const rl = makeRateLimiter();
    const dm = new DataManager(db, rl as never);

    const result = await dm.clearCache('uploads', makeUser());
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. checkYearCompletion / markYearComplete
// ---------------------------------------------------------------------------

describe('checkYearCompletion', () => {
  it('returns true when record exists', async () => {
    const completedYears = makeTable();
    completedYears.get.mockResolvedValue({id: '42_uploads_2023'} as never);

    const db = makeDb({completed_years: completedYears});
    const dm = new DataManager(db, makeRateLimiter() as never);

    expect(await dm.checkYearCompletion('42', 'uploads', 2023)).toBe(true);
  });

  it('returns false when record does not exist', async () => {
    const completedYears = makeTable();
    completedYears.get.mockResolvedValue(null);

    const db = makeDb({completed_years: completedYears});
    const dm = new DataManager(db, makeRateLimiter() as never);

    expect(await dm.checkYearCompletion('42', 'uploads', 2023)).toBe(false);
  });

  it('returns false on db error (fail-open)', async () => {
    const completedYears = makeTable();
    completedYears.get.mockRejectedValue(new Error('DB error'));

    const db = makeDb({completed_years: completedYears});
    const dm = new DataManager(db, makeRateLimiter() as never);

    expect(await dm.checkYearCompletion('42', 'uploads', 2023)).toBe(false);
  });
});

describe('markYearComplete', () => {
  it('stores the correct compound key', async () => {
    const completedYears = makeTable();
    const db = makeDb({completed_years: completedYears});
    const dm = new DataManager(db, makeRateLimiter() as never);

    await dm.markYearComplete('42', 'uploads', 2023);

    expect(completedYears.put).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '42_uploads_2023',
        userId: '42',
        metric: 'uploads',
        year: 2023,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. fetchRemoteCount
// ---------------------------------------------------------------------------

describe('fetchRemoteCount', () => {
  it('parses counts.posts from response', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 123}}),
    }));
    const dm = new DataManager(makeDb(), rl as never);

    expect(
      await dm.fetchRemoteCount('user:test date:2023-01-01...2024-01-01'),
    ).toBe(123);
  });

  it('returns 0 when response has no counts', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    const dm = new DataManager(makeDb(), rl as never);

    expect(await dm.fetchRemoteCount('user:test')).toBe(0);
  });

  it('throws on HTTP error', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const dm = new DataManager(makeDb(), rl as never);

    await expect(dm.fetchRemoteCount('user:test')).rejects.toThrow('HTTP 500');
  });
});

// ---------------------------------------------------------------------------
// 10. fetchAllPages — pagination and stop conditions
// ---------------------------------------------------------------------------

describe('fetchAllPages', () => {
  it('stops when an empty page is returned', async () => {
    let callCount = 0;
    const rl = makeRateLimiter(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => [{created_at: '2023-05-01T00:00:00Z'}],
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(makeDb(), rl as never);
    const items = await dm.fetchAllPages('/posts.json', {limit: 200}, null);

    expect(items).toHaveLength(1);
  });

  it('stops when page has fewer items than limit', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {created_at: '2023-05-01T00:00:00Z'},
        {created_at: '2023-05-02T00:00:00Z'},
      ],
    }));

    const dm = new DataManager(makeDb(), rl as never);
    const items = await dm.fetchAllPages('/posts.json', {limit: 200}, null);

    // 2 items < limit 200 → stops after first batch
    expect(items).toHaveLength(2 * 5); // 5 parallel pages, each returns 2
    // Actually: first batch is 5 pages, each has 2 items < 200, so stops
  });

  it('respects stopDate in desc direction', async () => {
    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {created_at: '2023-12-01T00:00:00Z'},
        {created_at: '2023-06-15T00:00:00Z'},
        {created_at: '2023-01-01T00:00:00Z'}, // before stopDate
      ],
    }));

    const dm = new DataManager(makeDb(), rl as never);
    const items = await dm.fetchAllPages(
      '/posts.json',
      {limit: 200},
      '2023-03-01',
      'created_at',
      'desc',
    );

    // Should include items on or after 2023-03-01 only
    const dates = items.map(i => (i['created_at'] as string).slice(0, 10));
    for (const d of dates) {
      expect(d >= '2023-03-01').toBe(true);
    }
  });

  it('retries on 429 with exponential backoff', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const rl = makeRateLimiter(async () => {
      attempts++;
      if (attempts <= 2) {
        return {ok: false, status: 429, json: async () => ({})};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(makeDb(), rl as never);
    const promise = dm.fetchAllPages('/posts.json', {limit: 200}, null);

    // Run through retries
    await vi.runAllTimersAsync();
    const items = await promise;

    expect(items).toHaveLength(0);
    // Should have retried
    expect(attempts).toBeGreaterThan(1);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 11. getMetricData — returns correct structure
// ---------------------------------------------------------------------------

describe('getMetricData — return value structure', () => {
  it('returns { daily, hourly } with correct types', async () => {
    const currentYear = new Date().getFullYear();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    const dm = new DataManager(db, rl as never);
    const result = await dm.getMetricData('uploads', makeUser(), currentYear);

    expect(result).toHaveProperty('daily');
    expect(result).toHaveProperty('hourly');
    expect(typeof result.daily).toBe('object');
    expect(Array.isArray(result.hourly)).toBe(true);
    expect(result.hourly).toHaveLength(24);
  });

  it('returns empty MetricData for unknown metric', async () => {
    const db = makeDb();
    const rl = makeRateLimiter();
    const dm = new DataManager(db, rl as never);

    const result = await dm.getMetricData(
      'unknown' as Metric,
      makeUser(),
      2023,
    );
    expect(result).toEqual({});
  });
});
