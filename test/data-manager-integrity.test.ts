/**
 * DataManager data integrity tests.
 *
 * Covers: remote/local count comparison, safe deletion boundaries,
 * year completion cache, 3-day safety buffer, user ID validation,
 * hourly stats delta merge, and clearCache.
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

  it('caps delta fetch end at today+2 days so TZ-ahead uploads are included', async () => {
    // Regression for the timezone bug where the upper bound was computed
    // as tomorrow-in-UTC. Danbooru's `date:A...B` is upper-bound-exclusive
    // and evaluated in the user's configured timezone, so when that TZ is
    // ahead of UTC (e.g. KST = UTC+9) today's uploads fell outside the
    // fetch range and never made it into the local cache.
    const now = new Date();
    const currentYear = now.getFullYear();

    // Cached data: a recent day so the delta path is taken
    const lastDate = new Date(now);
    lastDate.setDate(lastDate.getDate() - 1);
    const lastDateStr = lastDate.toISOString().slice(0, 10);

    const localRows = [
      {
        id: `42_${lastDateStr}`,
        userId: '42',
        date: lastDateStr,
        count: 1,
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

    const postsFetch = fetchedUrls.find(u => u.includes('/posts.json'));
    expect(postsFetch).toBeDefined();

    // Extract the `date:...END` upper bound from the tags query.
    const decoded = decodeURIComponent(postsFetch!);
    const m = decoded.match(/date:[^ &]*\.\.\.(\d{4}-\d{2}-\d{2})/);
    expect(m).not.toBeNull();
    const endDate = m![1];

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // Must be STRICTLY after tomorrow-in-UTC so that "today" in any
    // reasonable Danbooru TZ (up to UTC+14) is still captured despite
    // the exclusive upper bound.
    expect(endDate > tomorrowStr).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. clearCache
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

// ---------------------------------------------------------------------------
// 12. getMetricData — metric routing (approvals & notes endpoints)
// ---------------------------------------------------------------------------

describe('getMetricData — metric routing', () => {
  it('approvals: fetches /post_approvals.json with search[user_id]', async () => {
    const approvalsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      approvals: approvalsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const fetchedUrls: string[] = [];
    const rl = makeRateLimiter(async (url: string) => {
      fetchedUrls.push(url);
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('approvals', makeUser({id: '42'}), 2023);

    const approvalsFetch = fetchedUrls.find(u =>
      u.includes('/post_approvals.json'),
    );
    expect(approvalsFetch).toBeDefined();
    expect(approvalsFetch).toContain('search%5Buser_id%5D=42');
    // Must NOT call /counts/posts.json for approvals
    const countCalls = fetchedUrls.filter(u =>
      u.includes('/counts/posts.json'),
    );
    expect(countCalls).toHaveLength(0);
  });

  it('notes: fetches /note_versions.json with search[updater_id]', async () => {
    const notesTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      notes: notesTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const fetchedUrls: string[] = [];
    const rl = makeRateLimiter(async (url: string) => {
      fetchedUrls.push(url);
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('notes', makeUser({id: '42'}), 2023);

    const notesFetch = fetchedUrls.find(u => u.includes('/note_versions.json'));
    expect(notesFetch).toBeDefined();
    expect(notesFetch).toContain('search%5Bupdater_id%5D=42');
    // Must NOT call /counts/posts.json for notes
    const countCalls = fetchedUrls.filter(u =>
      u.includes('/counts/posts.json'),
    );
    expect(countCalls).toHaveLength(0);
  });

  it('notes: throws when userInfo.id is missing', async () => {
    const db = makeDb();
    const rl = makeRateLimiter();
    const dm = new DataManager(db, rl as never);

    await expect(
      dm.getMetricData('notes', makeUser({id: undefined}), 2023),
    ).rejects.toThrow('User ID required for Notes');
  });

  it('approvals: writes detail rows to approvals_detail when post_id present', async () => {
    const approvalsTable = makeTable();
    const approvalsDetail = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();
    const currentYear = new Date().getFullYear();

    const db = makeDb({
      approvals: approvalsTable,
      approvals_detail: approvalsDetail,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    let pageHit = 0;
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/post_approvals.json')) {
        pageHit++;
        if (pageHit === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                user_id: 42,
                post_id: 101,
                created_at: `${currentYear}-06-10T10:00:00Z`,
              },
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('approvals', makeUser({id: '42'}), currentYear);

    // approvals_detail should have been written
    expect(approvalsDetail.bulkPut).toHaveBeenCalled();
    const detailCalls = approvalsDetail.bulkPut.mock.calls as unknown[][];
    const detailRows = (detailCalls[0][0] as Array<{post_list: number[]}>)[0];
    expect(detailRows.post_list).toContain(101);
  });
});

// ---------------------------------------------------------------------------
// 13. getMetricData — onProgress callback
// ---------------------------------------------------------------------------

describe('getMetricData — onProgress callback', () => {
  it('invokes onProgress with monotonically increasing counts across pages', async () => {
    const currentYear = new Date().getFullYear();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    let pageCallCount = 0;
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/posts.json')) {
        pageCallCount++;
        if (pageCallCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () =>
              Array.from({length: 200}, (_, i) => ({
                uploader_id: 42,
                created_at: `${currentYear}-06-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
              })),
          };
        }
        if (pageCallCount === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                uploader_id: 42,
                created_at: `${currentYear}-07-01T10:00:00Z`,
              },
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const progressValues: number[] = [];
    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser(), currentYear, count => {
      progressValues.push(count);
    });

    // Progress must have been called at least once
    expect(progressValues.length).toBeGreaterThan(0);
    // Values must be non-decreasing
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. getMetricData — bulkPut into the correct table
// ---------------------------------------------------------------------------

describe('getMetricData — bulkPut target table', () => {
  it('writes aggregated daily rows to uploads table for metric=uploads', async () => {
    const currentYear = new Date().getFullYear();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

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
              {
                uploader_id: 42,
                created_at: `${currentYear}-08-05T09:00:00Z`,
              },
              {
                uploader_id: 42,
                created_at: `${currentYear}-08-05T15:00:00Z`,
              },
              {
                uploader_id: 42,
                created_at: `${currentYear}-08-06T12:00:00Z`,
              },
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser({id: '42'}), currentYear);

    expect(uploadsTable.bulkPut).toHaveBeenCalled();
    const bulkCalls1 = uploadsTable.bulkPut.mock.calls as unknown[][];
    const writtenRows = bulkCalls1[0][0] as Array<{
      date: string;
      count: number;
      userId: string;
    }>;
    const aug5 = writtenRows.find(r => r.date === `${currentYear}-08-05`);
    const aug6 = writtenRows.find(r => r.date === `${currentYear}-08-06`);
    // Two items on Aug 5 should be summed
    expect(aug5?.count).toBe(2);
    expect(aug6?.count).toBe(1);
    expect(aug5?.userId).toBe('42');
  });

  it('writes to notes table (not uploads) for metric=notes', async () => {
    const currentYear = new Date().getFullYear();
    const notesTable = makeTable();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      notes: notesTable,
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    let pageHit = 0;
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/note_versions.json')) {
        pageHit++;
        if (pageHit === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                updater_id: 42,
                created_at: `${currentYear}-09-01T10:00:00Z`,
              },
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('notes', makeUser({id: '42'}), currentYear);

    expect(notesTable.bulkPut).toHaveBeenCalled();
    expect(uploadsTable.bulkPut).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 15. getMetricData — fetchRemoteCount=0 for past year (no-op path)
// ---------------------------------------------------------------------------

describe('getMetricData — fetchRemoteCount returns 0', () => {
  it('does not delete rows when both remote and local counts are 0', async () => {
    const uploadsTable = makeTable(); // empty local
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
          json: async () => ({counts: {posts: 0}}),
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    const result = await dm.getMetricData('uploads', makeUser(), 2023);

    // Deletion should NOT fire when both counts are 0
    expect(uploadsTable._chain.delete).not.toHaveBeenCalled();
    // Function returns cleanly
    expect(result).toHaveProperty('daily');
    expect(result).toHaveProperty('hourly');
  });
});

// ---------------------------------------------------------------------------
// 16. getMetricData — multiple pages, same date summed
// ---------------------------------------------------------------------------

describe('getMetricData — multi-page aggregation', () => {
  it('sums counts across two pages for the same date', async () => {
    const currentYear = new Date().getFullYear();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    // Return a full page (200) on page 1 and a partial page on page 2,
    // both with the same date so they collapse in the aggregation map
    let pageCallCount = 0;
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/posts.json')) {
        pageCallCount++;
        if (pageCallCount === 1) {
          // 200 items (full page) — triggers a second batch
          return {
            ok: true,
            status: 200,
            json: async () =>
              Array.from({length: 200}, () => ({
                uploader_id: 42,
                created_at: `${currentYear}-10-01T10:00:00Z`,
              })),
          };
        }
        if (pageCallCount <= 5) {
          // Pages 2-5 in the same parallel batch each return 3 items
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                uploader_id: 42,
                created_at: `${currentYear}-10-01T11:00:00Z`,
              },
              {
                uploader_id: 42,
                created_at: `${currentYear}-10-01T12:00:00Z`,
              },
              {
                uploader_id: 42,
                created_at: `${currentYear}-10-01T13:00:00Z`,
              },
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser({id: '42'}), currentYear);

    expect(uploadsTable.bulkPut).toHaveBeenCalled();
    const bulkCalls2 = uploadsTable.bulkPut.mock.calls as unknown[][];
    const writtenRows = bulkCalls2[0][0] as Array<{
      date: string;
      count: number;
    }>;
    const oct1 = writtenRows.find(r => r.date === `${currentYear}-10-01`);
    // Must have at least 200 (from page 1) plus the items from pages 2-5
    expect(oct1?.count).toBeGreaterThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// 17. getMetricData — hourly accumulation
// ---------------------------------------------------------------------------

describe('getMetricData — hourly stats accumulation', () => {
  it('accumulates multiple items in the same hour into the same index', async () => {
    const currentYear = new Date().getFullYear();
    const uploadsTable = makeTable();
    const completedYears = makeTable();
    const hourlyStats = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    // All items at 10:xx → local hour computed from UTC (deterministic in test)
    const ts1 = `${currentYear}-11-10T10:00:00Z`;
    const ts2 = `${currentYear}-11-10T10:30:00Z`;
    const ts3 = `${currentYear}-11-10T10:45:00Z`;
    // Different hour
    const ts4 = `${currentYear}-11-10T15:00:00Z`;
    const hourOf10 = new Date(ts1).getHours();
    const hourOf15 = new Date(ts4).getHours();

    let pageHit = 0;
    const rl = makeRateLimiter(async (url: string) => {
      if (url.includes('/posts.json')) {
        pageHit++;
        if (pageHit === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {uploader_id: 42, created_at: ts1},
              {uploader_id: 42, created_at: ts2},
              {uploader_id: 42, created_at: ts3},
              {uploader_id: 42, created_at: ts4},
            ],
          };
        }
        return {ok: true, status: 200, json: async () => []};
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const dm = new DataManager(db, rl as never);
    await dm.getMetricData('uploads', makeUser({id: '42'}), currentYear);

    expect(hourlyStats.bulkPut).toHaveBeenCalled();
    const hourlyCalls = hourlyStats.bulkPut.mock.calls as unknown[][];
    const hourlyRows = hourlyCalls[0][0] as Array<{
      hour: number;
      count: number;
    }>;
    const slot10 = hourlyRows.find(r => r.hour === hourOf10);
    const slot15 = hourlyRows.find(r => r.hour === hourOf15);
    // 3 items at the same hour
    expect(slot10?.count).toBe(3);
    // 1 item at the other hour
    expect(slot15?.count).toBe(1);
  });

  it('loads existing hourly stats from DB when year is already complete', async () => {
    const completedYears = makeTable();
    completedYears.get.mockResolvedValue({id: '42_uploads_2022'} as never);

    const existingHourly = Array.from({length: 24}, (_, h) => ({
      id: `42_uploads_2022_${String(h).padStart(2, '0')}`,
      userId: '42',
      metric: 'uploads',
      year: 2022,
      hour: h,
      count: h + 1, // count = hour+1 for easy verification
    }));
    const hourlyStats = makeTable(existingHourly);
    const uploadsTable = makeTable();

    const db = makeDb({
      uploads: uploadsTable,
      completed_years: completedYears,
      hourly_stats: hourlyStats,
    });

    const rl = makeRateLimiter();
    const dm = new DataManager(db, rl as never);
    const result = await dm.getMetricData('uploads', makeUser(), 2022);

    // Result hourly array should reflect the cached DB values
    expect(result.hourly).toHaveLength(24);
    // Hour 0 should have count=1, hour 5 should have count=6, etc.
    expect(result.hourly[0]).toBe(1);
    expect(result.hourly[5]).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// v9.6: getStats(key, userId, maxAgeMs?) — count-cache TTL behaviour
// ---------------------------------------------------------------------------

describe('getStats — maxAgeMs TTL guard (v9.6)', () => {
  function buildDm(record: Record<string, unknown> | null) {
    const piestats = makeTable();
    piestats.get.mockResolvedValue(record as never);
    const db = makeDb({piestats});
    const rl = makeRateLimiter();
    return new DataManager(db, rl as never);
  }

  it('returns the cached data when no maxAgeMs is supplied (legacy path)', async () => {
    const dm = buildDm({
      key: 'copyright_dist',
      userId: 42,
      data: {tags: ['a', 'b']},
      updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = await dm.getStats('copyright_dist', 42);
    expect(result).toEqual({tags: ['a', 'b']});
  });

  it('returns the cached data when age is within maxAgeMs', async () => {
    const dm = buildDm({
      key: 'copyright_dist',
      userId: 42,
      data: {ok: true},
      // 5 minutes old
      updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const result = await dm.getStats('copyright_dist', 42, 10 * 60_000);
    expect(result).toEqual({ok: true});
  });

  it('returns null when age exceeds maxAgeMs', async () => {
    const dm = buildDm({
      key: 'copyright_dist',
      userId: 42,
      data: {ok: true},
      // 15 minutes old, TTL 10 min → expired
      updated_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    });
    const result = await dm.getStats('copyright_dist', 42, 10 * 60_000);
    expect(result).toBeNull();
  });

  it('returns null on a future-dated updated_at (clock skew)', async () => {
    const dm = buildDm({
      key: 'copyright_dist',
      userId: 42,
      data: {ok: true},
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await dm.getStats('copyright_dist', 42, 10 * 60_000);
    expect(result).toBeNull();
  });

  it('returns null when the record is missing entirely', async () => {
    const dm = buildDm(null);
    const result = await dm.getStats('copyright_dist', 42, 10 * 60_000);
    expect(result).toBeNull();
  });

  it('returns the cached data when updated_at is absent (legacy record, maxAgeMs ignored)', async () => {
    const dm = buildDm({
      key: 'copyright_dist',
      userId: 42,
      data: {legacy: true},
      // no updated_at field at all
    });
    const result = await dm.getStats('copyright_dist', 42, 10 * 60_000);
    expect(result).toEqual({legacy: true});
  });
});
