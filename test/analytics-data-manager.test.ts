import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {getBestThumbnailUrl} from '../src/utils';
import {
  isBackfillInCooldown,
  recordFailure,
  shouldCountHttpAsFailure,
  backfillFailureStorageKey,
  BACKFILL_FAILURE_THRESHOLD,
  BACKFILL_COOLDOWN_MS,
  type BackfillFailureState,
} from '../src/core/analytics-data-manager';

describe('getBestThumbnailUrl', () => {
  it('빈 post(null)이면 빈 문자열 반환', () => {
    expect(getBestThumbnailUrl(null)).toBe('');
  });

  it('variants에 720x720 webp가 있으면 그 URL 반환', () => {
    const post = {
      variants: [
        {type: '360x360', file_ext: 'webp', url: 'http://example.com/360.webp'},
        {type: '720x720', file_ext: 'webp', url: 'http://example.com/720.webp'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/720.webp');
  });

  it('720x720 webp 없으면 360x360 webp 반환', () => {
    const post = {
      variants: [
        {type: '360x360', file_ext: 'webp', url: 'http://example.com/360.webp'},
        {type: '720x720', file_ext: 'jpg', url: 'http://example.com/720.jpg'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/360.webp');
  });

  it('webp 없으면 preferred type(720x720) 중 첫 번째 반환', () => {
    const post = {
      variants: [
        {type: '720x720', file_ext: 'jpg', url: 'http://example.com/720.jpg'},
        {type: '360x360', file_ext: 'png', url: 'http://example.com/360.png'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/720.jpg');
  });

  it('preferred type 없으면 첫 번째 variant URL 반환', () => {
    const post = {
      variants: [
        {
          type: 'original',
          file_ext: 'png',
          url: 'http://example.com/original.png',
        },
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/original.png');
  });

  it('variants가 빈 배열이면 preview_file_url fallback', () => {
    const post = {
      variants: [],
      preview_file_url: 'http://example.com/preview.jpg',
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/preview.jpg');
  });

  it('variants 없으면 file_url fallback', () => {
    const post = {
      file_url: 'http://example.com/file.jpg',
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/file.jpg');
  });

  it('모든 fallback 없으면 빈 문자열', () => {
    expect(getBestThumbnailUrl({})).toBe('');
  });
});

// ============================================================
// Task 4 — Backfill error recovery: threshold + cooldown logic
// ============================================================
//
// These tests cover the pure functions exported from analytics-data-manager
// (isBackfillInCooldown, recordFailure, shouldCountHttpAsFailure,
// backfillFailureStorageKey). They intentionally do NOT exercise the class
// methods or the Dexie/RateLimiter integration — that would require full
// mocks for the data layer, which is out of scope for this task. The pure
// helpers carry the entire decision logic, so testing them is sufficient
// per the acceptance criterion.

describe('isBackfillInCooldown', () => {
  it('returns false when state is null (never failed)', () => {
    expect(isBackfillInCooldown(null, Date.now())).toBe(false);
  });

  it('returns false when failureCount is below threshold', () => {
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD - 1,
      lastAttemptAt: Date.now(),
    };
    expect(isBackfillInCooldown(state, Date.now())).toBe(false);
  });

  it('returns true when failureCount equals threshold and within window', () => {
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD,
      lastAttemptAt: now - 1000, // 1 second ago
    };
    expect(isBackfillInCooldown(state, now)).toBe(true);
  });

  it('returns true when failureCount exceeds threshold and within window', () => {
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: 10,
      lastAttemptAt: now - 60 * 60 * 1000, // 1 hour ago
    };
    expect(isBackfillInCooldown(state, now)).toBe(true);
  });

  it('returns false when cooldown window has elapsed', () => {
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: 5,
      lastAttemptAt: now - (BACKFILL_COOLDOWN_MS + 1000), // just past 24h
    };
    expect(isBackfillInCooldown(state, now)).toBe(false);
  });

  it('returns true at the exact boundary of the cooldown window', () => {
    // (now - lastAttemptAt) === BACKFILL_COOLDOWN_MS - 1ms → still inside
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD,
      lastAttemptAt: now - (BACKFILL_COOLDOWN_MS - 1),
    };
    expect(isBackfillInCooldown(state, now)).toBe(true);
  });

  it('returns false at exactly cooldown duration (boundary is exclusive)', () => {
    // The check is `now - lastAttemptAt < COOLDOWN_MS`. Equal → not less.
    const now = 1_000_000_000_000;
    const state: BackfillFailureState = {
      failureCount: BACKFILL_FAILURE_THRESHOLD,
      lastAttemptAt: now - BACKFILL_COOLDOWN_MS,
    };
    expect(isBackfillInCooldown(state, now)).toBe(false);
  });
});

describe('recordFailure', () => {
  it('returns count 1 when starting from null state', () => {
    const next = recordFailure(null, 12345);
    expect(next.failureCount).toBe(1);
    expect(next.lastAttemptAt).toBe(12345);
  });

  it('increments failureCount from existing state', () => {
    const prev: BackfillFailureState = {
      failureCount: 2,
      lastAttemptAt: 1000,
    };
    const next = recordFailure(prev, 5000);
    expect(next.failureCount).toBe(3);
    expect(next.lastAttemptAt).toBe(5000);
  });

  it('does not mutate the previous state', () => {
    const prev: BackfillFailureState = {
      failureCount: 1,
      lastAttemptAt: 1000,
    };
    recordFailure(prev, 9999);
    expect(prev).toEqual({failureCount: 1, lastAttemptAt: 1000});
  });
});

describe('shouldCountHttpAsFailure', () => {
  it('does NOT count 429 as a hard failure (rate-limiter handles it)', () => {
    expect(shouldCountHttpAsFailure(429)).toBe(false);
  });

  it.each([500, 503, 404, 401])('counts %i as a hard failure', code => {
    expect(shouldCountHttpAsFailure(code)).toBe(true);
  });
});

describe('backfillFailureStorageKey', () => {
  it('produces a per-user storage key', () => {
    expect(backfillFailureStorageKey(123)).toBe('di_backfill_failure_123');
  });
});

// ============================================================
// AnalyticsDataManager.syncAllPosts — integration-style tests
// ============================================================
//
// Uses vi.mock for quota-manager so bulkPutSafe/requestPersistence are
// fully under test control (option b from T-20 spec). The posts table
// uses a purpose-built chain mock that supports the extra Dexie methods
// syncAllPosts calls: .reverse(), .limit(), .until(), .filter().

vi.mock('../src/core/quota-manager', () => ({
  bulkPutSafe: vi.fn(
    async (
      table: {bulkPut: (rows: unknown[]) => Promise<void>},
      records: unknown[],
    ) => {
      await table.bulkPut(records);
    },
  ),
  requestPersistence: vi.fn(async () => true),
  evictOldestNonCurrentUser: vi.fn(async () => undefined),
}));

import {AnalyticsDataManager} from '../src/core/analytics-data-manager';
import type {TargetUser} from '../src/types';
import * as quotaManager from '../src/core/quota-manager';

/** Build a chainable posts-table mock.
 *  rows: what .toArray() / .each() returns
 *  filterFn: optional custom filter for .filter() calls
 */
function makePostsChain(
  rows: Record<string, unknown>[],
  eachFn?: (cb: (row: Record<string, unknown>) => void) => void,
) {
  // We use a chainable object; all modifiers return `this`.
  const chain: Record<string, unknown> = {
    reverse: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    until: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
    each: vi.fn(async (cb: (row: Record<string, unknown>) => void) => {
      if (eachFn) {
        eachFn(cb);
      } else {
        rows.forEach(cb);
      }
    }),
    toArray: vi.fn(async () => [...rows]),
    count: vi.fn(async () => rows.length),
    delete: vi.fn(async () => rows.length),
    uniqueKeys: vi.fn(async () => []),
    orderBy: vi.fn().mockReturnThis(),
  };
  // Make all modifier fns return the chain itself
  (chain.reverse as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.limit as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.until as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.filter as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.equals as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

/** Build a posts table mock. */
function makePostsTable(rows: Record<string, unknown>[] = []) {
  const chain = makePostsChain(rows);
  return {
    where: vi.fn().mockReturnValue(chain),
    orderBy: vi.fn().mockReturnValue(chain),
    bulkPut: vi.fn(async () => undefined),
    _chain: chain,
  };
}

/** Build a minimal piestats table mock. */
function makePiestatsTable() {
  const chain = {
    equals: vi.fn().mockReturnThis(),
    delete: vi.fn(async () => 0),
  };
  return {
    where: vi.fn().mockReturnValue(chain),
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    bulkPut: vi.fn(async () => undefined),
    _chain: chain,
  };
}

/** Minimal db mock for AnalyticsDataManager. */
function makeSyncDb(
  postsTable: ReturnType<typeof makePostsTable>,
  overrides: Record<string, unknown> = {},
) {
  return {
    posts: postsTable,
    piestats: makePiestatsTable(),
    uploads: {
      where: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnThis(),
        each: vi.fn(async () => {}),
        last: vi.fn(async () => null),
        toArray: vi.fn(async () => []),
      }),
      bulkPut: vi.fn(async () => undefined),
    },
    approvals: {
      where: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnThis(),
        each: vi.fn(async () => {}),
        last: vi.fn(async () => null),
        toArray: vi.fn(async () => []),
      }),
      bulkPut: vi.fn(async () => undefined),
    },
    approvals_detail: {bulkPut: vi.fn(async () => undefined)},
    notes: {
      where: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnThis(),
        each: vi.fn(async () => {}),
        last: vi.fn(async () => null),
        toArray: vi.fn(async () => []),
      }),
      bulkPut: vi.fn(async () => undefined),
    },
    completed_years: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      where: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnThis(),
        toArray: vi.fn(async () => []),
        primaryKeys: vi.fn(async () => []),
        delete: vi.fn(async () => 0),
      }),
      bulkDelete: vi.fn(async () => undefined),
    },
    hourly_stats: {
      where: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnThis(),
        toArray: vi.fn(async () => []),
      }),
      bulkPut: vi.fn(async () => undefined),
    },
    grass_settings: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      where: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnThis(),
        toArray: vi.fn(async () => []),
      }),
    },
    tag_analytics: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    },
    user_stats: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    },
    tag_monthly_counts: {
      where: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnThis(),
        toArray: vi.fn(async () => []),
      }),
    },
    tag_implications_cache: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    },
    transaction: vi.fn(
      async (_mode: string, _tables: unknown[], cb: () => Promise<void>) => {
        await cb();
      },
    ),
    ...overrides,
  };
}

/** A standard test user for sync tests. */
function makeSyncUser(overrides: Partial<TargetUser> = {}): TargetUser {
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

/** Build a minimal rate-limiter mock for syncAllPosts tests. */
function makeSyncRateLimiter(
  fetchImpl?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>,
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

describe('AnalyticsDataManager.syncAllPosts', () => {
  beforeEach(() => {
    // Reset static lock before every test
    AnalyticsDataManager.isGlobalSyncing = false;
    AnalyticsDataManager.onProgressCallback = null;
    // Stub browser globals needed by constructors / sync logic
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    // Use a proper constructor so `new AbortController()` doesn't throw.
    // The rate-limiter mock ignores the signal, so aborting it early is harmless.
    class FakeAbortController {
      signal = {aborted: false};
      abort() {
        this.signal.aborted = true;
      }
    }
    vi.stubGlobal('AbortController', FakeAbortController);
    // Immediately invoke setTimeout callbacks so worker delays and timeout
    // timers don't actually wait. The rate-limiter mock ignores the abort
    // signal, so calling abort() before the fetch resolves is harmless.
    vi.stubGlobal('setTimeout', (fn: () => void, _ms: number) => {
      fn();
      return 0;
    });
    vi.stubGlobal('clearTimeout', vi.fn());
    // Reset quota-manager mocks
    vi.mocked(quotaManager.bulkPutSafe).mockClear();
    vi.mocked(quotaManager.requestPersistence).mockClear();
  });

  afterEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns early without touching db when userInfo.id is missing', async () => {
    const postsTable = makePostsTable();
    const db = makeSyncDb(postsTable);
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(db as never, rl as never);

    const progress = vi.fn();
    await adm.syncAllPosts(makeSyncUser({id: undefined}), progress);

    expect(postsTable.where).not.toHaveBeenCalled();
    expect(rl.fetch).not.toHaveBeenCalled();
    // Lock must remain false (it was never set to true)
    expect(AnalyticsDataManager.isGlobalSyncing).toBe(false);
  });

  it('returns early when isGlobalSyncing is already true', async () => {
    AnalyticsDataManager.isGlobalSyncing = true;
    const postsTable = makePostsTable();
    const db = makeSyncDb(postsTable);
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(db as never, rl as never);

    const progress = vi.fn();
    await adm.syncAllPosts(makeSyncUser(), progress);

    // Nothing should happen — lock was already held
    expect(postsTable.where).not.toHaveBeenCalled();
    expect(rl.fetch).not.toHaveBeenCalled();
    // Clean up the flag we set
    AnalyticsDataManager.isGlobalSyncing = false;
  });

  it('isGlobalSyncing is released in finally even when db throws during resume check', async () => {
    // Make the posts table's where() throw so the outer try-block propagates the error
    const postsTable = makePostsTable([]);
    postsTable.where.mockImplementation(() => {
      throw new Error('db read error');
    });
    const db = makeSyncDb(postsTable);

    // getTotalPostCount: make /counts/posts.json succeed so we get past it
    // (getTotalPostCount catches errors internally, but fetchRemoteCount called
    //  from getTotalPostCount will throw on HTTP error — so we can make it succeed
    //  and let the db.posts.where call throw instead)
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 5}}),
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const adm = new AnalyticsDataManager(db as never, rl as never);
    const progress = vi.fn();

    await expect(adm.syncAllPosts(makeSyncUser(), progress)).rejects.toThrow(
      'db read error',
    );

    // Flag MUST be back to false after the throw (finally block runs)
    expect(AnalyticsDataManager.isGlobalSyncing).toBe(false);
  });

  it('total=0 with empty db: workers find nothing and sync completes without writing', async () => {
    // When total=0 (API returned 0) and there is no local history, workers spin
    // up and immediately get empty pages, so bulkPutSafe is never called.
    // This also verifies the sync lock is released in the finally block.
    const postsTable = makePostsTable([]);
    const db = makeSyncDb(postsTable);

    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 0}}),
        };
      }
      // All page fetches return empty → workers stop
      return {ok: true, status: 200, json: async () => []};
    });

    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshAllStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const progress = vi.fn();
    await adm.syncAllPosts(makeSyncUser(), progress);

    // bulkPutSafe was NOT called (no records to write)
    expect(quotaManager.bulkPutSafe).not.toHaveBeenCalled();
    // Progress callback was still invoked at least once (reportProgress is called per page)
    expect(progress).toHaveBeenCalled();
    // Lock released
    expect(AnalyticsDataManager.isGlobalSyncing).toBe(false);
  });

  it('happy path: total=3, single page — normalised records written and metadata set', async () => {
    // Posts table is empty → no history, startId=0
    const postsTable = makePostsTable([]);
    const db = makeSyncDb(postsTable);

    const fakePosts = [
      {
        id: 101,
        uploader_id: 42,
        created_at: '2025-01-01T10:00:00Z',
        up_score: 5,
        down_score: -1,
        is_deleted: false,
        is_banned: false,
        rating: 'g',
        tag_count_general: 10,
        variants: [],
        preview_file_url: 'https://example.com/p1.jpg',
      },
      {
        id: 102,
        uploader_id: 42,
        created_at: '2025-01-02T10:00:00Z',
        up_score: 3,
        down_score: 0,
        is_deleted: false,
        is_banned: false,
        rating: 's',
        tag_count_general: 5,
        variants: [],
        preview_file_url: 'https://example.com/p2.jpg',
      },
      {
        id: 103,
        uploader_id: 42,
        created_at: '2025-01-03T10:00:00Z',
        up_score: 10,
        down_score: -2,
        is_deleted: false,
        is_banned: false,
        rating: 'q',
        tag_count_general: 8,
        variants: [],
        preview_file_url: '',
      },
    ];

    // Use a counter so we can return fakePosts on exactly the first /posts.json call
    let postsCallCount = 0;
    const rl2 = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 3}}),
        };
      }
      if (url.includes('/posts.json')) {
        postsCallCount++;
        if (postsCallCount === 1) {
          return {ok: true, status: 200, json: async () => fakePosts};
        }
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const adm2 = new AnalyticsDataManager(db as never, rl2 as never);
    vi.spyOn(adm2, 'refreshAllStats').mockResolvedValue();
    vi.spyOn(adm2, 'cleanupStaleData').mockResolvedValue();

    const progress = vi.fn();
    await adm2.syncAllPosts(makeSyncUser({id: '42'}), progress);

    // bulkPutSafe was called (via quota-manager mock it calls postsTable.bulkPut)
    expect(quotaManager.bulkPutSafe).toHaveBeenCalled();

    // The normalised rows should have the required fields
    const [, writtenRecords] = (
      quotaManager.bulkPutSafe as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [
      unknown,
      Array<{
        id: number;
        no: number;
        score: number;
        up_score: number;
        down_score: number;
        is_deleted: boolean;
        is_banned: boolean;
      }>,
    ];
    expect(writtenRecords.length).toBeGreaterThan(0);
    const first = writtenRecords[0];
    expect(first).toHaveProperty('no');
    expect(first).toHaveProperty('score');
    expect(first).toHaveProperty('up_score');
    expect(first).toHaveProperty('down_score');
    expect(first).toHaveProperty('is_deleted');
    expect(first).toHaveProperty('is_banned');
    // score = up_score + down_score
    expect(first.score).toBe(first.up_score + first.down_score);

    // localStorage keys set
    const ls = vi.mocked(localStorage.setItem);
    const syncKeySet = ls.mock.calls.some((c: string[]) =>
      c[0].startsWith('danbooru_grass_last_sync_'),
    );
    expect(syncKeySet).toBe(true);
    // di_post_metadata_v2_42 set because startId=0 (full sync)
    const metaKeySet = ls.mock.calls.some(
      (c: string[]) => c[0] === 'di_post_metadata_v2_42',
    );
    expect(metaKeySet).toBe(true);

    // cleanupStaleData and refreshAllStats were called
    expect(adm2.cleanupStaleData).toHaveBeenCalledWith('42');
    expect(adm2.refreshAllStats).toHaveBeenCalledWith(
      expect.objectContaining({id: '42'}),
      true, // full sync
    );

    // requestPersistence was called
    expect(quotaManager.requestPersistence).toHaveBeenCalled();
  });

  it('partial sync: di_post_metadata_v2 NOT set when startId > 0', async () => {
    // Give the posts table a "newest" post from 2 months ago so the cutoff
    // search finds a post older than 1 month → startId will be set > 0.
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 2);
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5);

    // newestArr returns [recentPost] (within 1 month)
    // until().each() iterates [recentPost, oldPost] and finds oldPost < cutoff → startId=999
    const postsRows = [
      {
        id: 999,
        uploader_id: 42,
        created_at: oldDate.toISOString(),
        no: 10,
      },
    ];
    const postsChain = makePostsChain(postsRows);
    // Override toArray to return [recentPost] for the limit(1) call
    (postsChain.toArray as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 1000,
        uploader_id: 42,
        created_at: recentDate.toISOString(),
        no: 20,
      },
    ]);
    // The until().each() call should iterate [oldPost] and set startId=999
    (postsChain.each as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (cb: (row: Record<string, unknown>) => void) => {
        cb({
          id: 999,
          uploader_id: 42,
          created_at: oldDate.toISOString(),
          no: 10,
        });
      },
    );
    // .filter().count() for currentNo
    (postsChain.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);

    const postsTable = makePostsTable();
    postsTable.where.mockReturnValue(postsChain);

    const db = makeSyncDb(postsTable);
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 20}}),
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshAllStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const progress = vi.fn();
    await adm.syncAllPosts(makeSyncUser({id: '42'}), progress);

    // di_post_metadata_v2_42 must NOT be set for partial sync
    const ls = vi.mocked(localStorage.setItem);
    const metaKeySet = ls.mock.calls.some(
      (c: string[]) => c[0] === 'di_post_metadata_v2_42',
    );
    expect(metaKeySet).toBe(false);

    // refreshAllStats called with isFullSync=false
    expect(adm.refreshAllStats).toHaveBeenCalledWith(
      expect.objectContaining({id: '42'}),
      false,
    );
  });
});
