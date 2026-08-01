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
    anyOf: vi.fn().mockReturnThis(),
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
  (chain.anyOf as ReturnType<typeof vi.fn>).mockReturnValue(chain);
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
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
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
    vi.spyOn(adm2, 'refreshCriticalStats').mockResolvedValue();
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

    // cleanupStaleData and refreshCriticalStats were called
    expect(adm2.cleanupStaleData).toHaveBeenCalledWith('42');
    expect(adm2.refreshCriticalStats).toHaveBeenCalledWith(
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
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const progress = vi.fn();
    await adm.syncAllPosts(makeSyncUser({id: '42'}), progress);

    // di_post_metadata_v2_42 must NOT be set for partial sync
    const ls = vi.mocked(localStorage.setItem);
    const metaKeySet = ls.mock.calls.some(
      (c: string[]) => c[0] === 'di_post_metadata_v2_42',
    );
    expect(metaKeySet).toBe(false);

    // refreshCriticalStats called with isFullSync=false
    expect(adm.refreshCriticalStats).toHaveBeenCalledWith(
      expect.objectContaining({id: '42'}),
      false,
    );
  });
});

// ============================================================
// v9.6.2 — Dynamic candidate pool + count rerank (T-RR08)
// ============================================================
//
// Integration-style smoke tests covering the new behaviour of
// getCharacterDistribution / getCopyrightDistribution /
// getFavCopyrightDistribution. We stub attachSubTagBreakdowns,
// enrichThumbnails, and getTotalPostCount so the test stays
// focused on the selection / filter / rerank pipeline.

interface RelatedTagFixture {
  name: string;
  frequency: number;
  /** false → /tag_implications.json returns 1 row (variant), true → []. */
  isTopLevel: boolean;
  /** Per-user (or per-fav) count returned by /counts/posts.json. */
  count: number;
  /** Optional global post_count carried on tag — only used by char/copy fallback. */
  postCount?: number;
}

interface FetchScript {
  related: RelatedTagFixture[];
  totalPostCount: number;
}

function buildDistFetch(
  script: FetchScript,
  countQueryPrefix: 'user' | 'fav',
): (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}> {
  const tagByName = new Map(script.related.map(r => [r.name, r]));
  return async (rawUrl: string) => {
    const url = decodeURIComponent(rawUrl);
    if (url.startsWith('/related_tag.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          related_tags: script.related.map(r => ({
            frequency: r.frequency,
            tag: {name: r.name, post_count: r.postCount ?? r.count},
          })),
        }),
      };
    }
    if (url.startsWith('/tag_implications.json')) {
      const m = url.match(/antecedent_name_matches\]=([^&]+)/);
      const name = m ? m[1] : '';
      const t = tagByName.get(name);
      // top-level → empty array. variant → 1 row.
      return {
        ok: true,
        status: 200,
        json: async () => (t && !t.isTopLevel ? [{id: 1}] : []),
      };
    }
    if (url.startsWith('/counts/posts.json')) {
      // tags=user:NAME alone → getTotalPostCount; tags=user:NAME tagname → per-tag
      const tagsMatch = url.match(/tags=([^&]+)/);
      const tags = tagsMatch ? tagsMatch[1] : '';
      const parts = tags.split(/\s+/);
      if (parts.length === 1 && parts[0].startsWith(`${countQueryPrefix}:`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: script.totalPostCount}}),
        };
      }
      const last = parts[parts.length - 1];
      const t = tagByName.get(last);
      return {
        ok: true,
        status: 200,
        json: async () => ({counts: {posts: t ? t.count : 0}}),
      };
    }
    return {ok: true, status: 200, json: async () => ({})};
  };
}

function makeDistAdm(
  fetchImpl: ReturnType<typeof buildDistFetch>,
  totalPostCount: number,
) {
  const postsTable = makePostsTable([]);
  const db = makeSyncDb(postsTable);
  const rl = makeSyncRateLimiter(fetchImpl);
  const adm = new AnalyticsDataManager(db as never, rl as never);
  // Strip out side-effects unrelated to the selection pipeline.
  vi.spyOn(
    adm as unknown as {
      attachSubTagBreakdowns: () => Promise<void>;
    },
    'attachSubTagBreakdowns',
  ).mockResolvedValue();
  vi.spyOn(
    adm as unknown as {
      enrichThumbnails: () => Promise<void>;
    },
    'enrichThumbnails',
  ).mockResolvedValue();
  vi.spyOn(adm, 'getTotalPostCount').mockResolvedValue(totalPostCount);
  return {adm, rl, db, postsTable};
}

describe('getCharacterDistribution — dynamic pool + filter + rerank', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('filters out variant characters (only base survives top-10)', async () => {
    // Frequency-ranked: abigail_williams_(fate) is a variant, base wins
    const script: FetchScript = {
      totalPostCount: 50_000,
      related: [
        {
          name: 'abigail_williams_(fate)',
          frequency: 0.05,
          isTopLevel: true,
          count: 600,
        },
        {
          name: 'abigail_williams_(first_ascension)_(fate)',
          frequency: 0.04,
          isTopLevel: false, // variant — filtered out
          count: 500,
        },
        {
          name: 'jeanne_d_arc_(fate)',
          frequency: 0.03,
          isTopLevel: true,
          count: 400,
        },
        {
          name: 'mash_kyrielight',
          frequency: 0.025,
          isTopLevel: true,
          count: 300,
        },
        {
          name: 'artoria_pendragon_(fate)',
          frequency: 0.02,
          isTopLevel: true,
          count: 250,
        },
      ],
    };
    const {adm} = makeDistAdm(buildDistFetch(script, 'user'), 50_000);

    const result = await adm.getCharacterDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    const tagNames = result.filter(r => !r.isOther).map(r => r.tagName);
    expect(tagNames).toContain('abigail_williams_(fate)');
    expect(tagNames).not.toContain('abigail_williams_(first_ascension)_(fate)');
  });

  it('reranks by count when frequency order disagrees', async () => {
    // High frequency but low count → should fall below low-frequency but high-count
    const script: FetchScript = {
      totalPostCount: 300_000, // → charPoolSize: filtered 75, raw 113
      related: [
        // Lots of top-level characters; ranks below by count
        {
          name: 'low_count_high_freq',
          frequency: 0.5,
          isTopLevel: true,
          count: 100,
        },
        {
          name: 'high_count_low_freq',
          frequency: 0.1,
          isTopLevel: true,
          count: 5000,
        },
        {name: 'mid_a', frequency: 0.05, isTopLevel: true, count: 800},
        {name: 'mid_b', frequency: 0.04, isTopLevel: true, count: 700},
      ],
    };
    const {adm} = makeDistAdm(buildDistFetch(script, 'user'), 300_000);

    const result = await adm.getCharacterDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    const non = result.filter(r => !r.isOther);
    expect(non[0].tagName).toBe('high_count_low_freq'); // count 5000 wins
    expect(non[1].tagName).toBe('mid_a');
    expect(non[non.length - 1].tagName).toBe('low_count_high_freq');
  });

  it('small user (N=3000) uses the legacy 10-item pool (no-op stability)', async () => {
    const related: RelatedTagFixture[] = [];
    for (let i = 0; i < 12; i++) {
      related.push({
        name: `char_${String(i).padStart(2, '0')}`,
        frequency: (12 - i) / 100,
        isTopLevel: true,
        count: (12 - i) * 10,
      });
    }
    const script: FetchScript = {totalPostCount: 3000, related};
    const {adm, rl} = makeDistAdm(buildDistFetch(script, 'user'), 3000);

    const result = await adm.getCharacterDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    const non = result.filter(r => !r.isOther);
    // filtered = 10 → top-10 by count desc: char_00..char_09
    expect(non.length).toBe(10);
    expect(non[0].tagName).toBe('char_00');
    expect(non[9].tagName).toBe('char_09');

    // For small users charPoolSize returns raw=15 — only 15 implication checks
    const impCalls = rl.fetch.mock.calls.filter((c: [string]) =>
      c[0].startsWith('/tag_implications.json'),
    );
    expect(impCalls.length).toBeLessThanOrEqual(15);
  });

  it('Others slice is count-based (N − Σ top10.count)', async () => {
    // N=10_000. top 10 counts 100..1000 sum = 5500 → Others = 4500.
    const related: RelatedTagFixture[] = [];
    for (let i = 0; i < 10; i++) {
      related.push({
        name: `char_${i}`,
        frequency: (10 - i) / 100,
        isTopLevel: true,
        count: (10 - i) * 100,
      });
    }
    const script: FetchScript = {totalPostCount: 10_000, related};
    const {adm} = makeDistAdm(buildDistFetch(script, 'user'), 10_000);

    const result = await adm.getCharacterDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    const others = result.find(r => r.isOther);
    expect(others).toBeDefined();
    expect(others?.count).toBe(4500);
    // Legacy frequency field zeroed on the count-based Others slice.
    expect(others?.frequency).toBe(0);
  });

  it('Others slice omitted when Σ top10.count exceeds N (multi-tag overlap)', async () => {
    // N=1000 but per-tag counts sum well past N (a single post with 12 chars
    // counts in each tag's bucket). Others is clamped to 0 → not pushed.
    const related: RelatedTagFixture[] = [];
    for (let i = 0; i < 10; i++) {
      related.push({
        name: `char_${i}`,
        frequency: 0.4,
        isTopLevel: true,
        count: 900, // 10 × 900 = 9000 ≫ N=1000
      });
    }
    const script: FetchScript = {totalPostCount: 1000, related};
    const {adm} = makeDistAdm(buildDistFetch(script, 'user'), 1000);

    const result = await adm.getCharacterDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    expect(result.find(r => r.isOther)).toBeUndefined();
  });
});

describe('getCopyrightDistribution — dynamic pool + rerank (method A margin)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('survives filter losses and still reranks survivors by count', async () => {
    // N=150_000 → copyPoolSize: filtered 30, raw 45.
    // We seed 12 top-level candidates and 8 variants interleaved by
    // frequency, so the filter halves the field but enough survive.
    const related: RelatedTagFixture[] = [];
    for (let i = 0; i < 20; i++) {
      const isTL = i % 2 === 0; // even = top-level, odd = variant
      related.push({
        name: isTL ? `franchise_${i}` : `franchise_${i}_variant`,
        frequency: (20 - i) / 100,
        isTopLevel: isTL,
        count: isTL ? (20 - i) * 100 : 9999, // variants would dominate by count if not filtered
      });
    }
    const script: FetchScript = {totalPostCount: 150_000, related};
    const {adm} = makeDistAdm(buildDistFetch(script, 'user'), 150_000);

    const result = await adm.getCopyrightDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    const non = result.filter(r => !r.isOther);
    // All survivors are top-level
    expect(non.every(r => r.tagName?.includes('_variant') === false)).toBe(
      true,
    );
    // Highest-count top-level (franchise_0, count 2000) ranks first
    expect(non[0].tagName).toBe('franchise_0');
  });
});

describe('getFavCopyrightDistribution — uses fav: count query', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('per-tag count fetch uses fav: prefix (not user:)', async () => {
    const script: FetchScript = {
      totalPostCount: 50_000,
      related: [
        {name: 'fate', frequency: 0.3, isTopLevel: true, count: 300},
        {
          name: 'kantai_collection',
          frequency: 0.2,
          isTopLevel: true,
          count: 200,
        },
        {name: 'touhou', frequency: 0.15, isTopLevel: true, count: 150},
      ],
    };
    const {adm, rl} = makeDistAdm(buildDistFetch(script, 'fav'), 50_000);

    await adm.getFavCopyrightDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    const perTagCounts = rl.fetch.mock.calls
      .map((c: [string]) => decodeURIComponent(c[0]))
      .filter(
        (u: string) =>
          u.startsWith('/counts/posts.json') && u.includes('tags=fav:'),
      );
    // At least one per-tag call uses fav:tester <tagName>
    const hasFavTagCall = perTagCounts.some((u: string) =>
      /fav:tester\s+\w+/.test(u),
    );
    expect(hasFavTagCall).toBe(true);
    // No user: prefix per-tag calls
    const userTagCalls = rl.fetch.mock.calls.filter((c: [string]) => {
      const u = decodeURIComponent(c[0]);
      return /tags=user:tester\s+\w+/.test(u);
    });
    expect(userTagCalls.length).toBe(0);
  });

  it('Others base = totalFavCount (separate fav-only count fetch)', async () => {
    // totalPostCount in buildDistFetch maps the single-prefix URL response.
    // For fav: prefix that becomes the total fav-set size used as Others base.
    const script: FetchScript = {
      totalPostCount: 2000, // → totalFavCount via /counts/posts.json?tags=fav:tester
      related: [
        {name: 'fate', frequency: 0.3, isTopLevel: true, count: 300},
        {
          name: 'kantai_collection',
          frequency: 0.2,
          isTopLevel: true,
          count: 200,
        },
        {name: 'touhou', frequency: 0.15, isTopLevel: true, count: 150},
      ],
    };
    const {adm, rl} = makeDistAdm(buildDistFetch(script, 'fav'), 999_999);
    // Note: getTotalPostCount is stubbed to a large value (999_999) above,
    // but fav distribution must NOT use that — it must hit /counts/posts.json
    // for fav:tester (the script's `totalPostCount` field).

    const result = await adm.getFavCopyrightDistribution(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    const others = result.find(r => r.isOther);
    // totalFavCount=2000 − Σ top10.count (300+200+150=650) = 1350
    expect(others?.count).toBe(1350);

    // Verify the fav-only count fetch happened
    const favOnlyCall = rl.fetch.mock.calls.some((c: [string]) => {
      const u = decodeURIComponent(c[0]);
      return /^\/counts\/posts\.json\?tags=fav:tester$/.test(u);
    });
    expect(favOnlyCall).toBe(true);
  });
});

describe('getRecentPostsPreview — uploader tag-count (mintag) join', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('attaches uploaderTagCount from the upload versions, joined by post id', async () => {
    const rl = makeSyncRateLimiter(async (url: string) => {
      let body: unknown = [];
      if (url.includes('/post_versions.json')) {
        body = [
          {post_id: 1, added_tags: ['a', 'b']}, // 2 → mintagged
          {post_id: 2, added_tags: Array.from({length: 30}, (_, i) => `t${i}`)},
          // post 3 absent → uploaderTagCount stays undefined (fail-open)
        ];
      } else if (url.includes('status%3Aappealed')) {
        body = [];
      } else {
        body = [
          {id: 1, rating: 'g', score: 5, tag_count_general: 20},
          {id: 2, rating: 's', score: 5, tag_count_general: 20},
          {id: 3, rating: 'e', score: 5, tag_count_general: 20},
        ];
      }
      return {ok: true, status: 200, json: async () => body};
    });
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable()) as never,
      rl as never,
    );

    const previews = await adm.getRecentPostsPreview(
      makeSyncUser({id: '42', name: 'tester'}),
      10,
    );
    expect(previews.map(p => p.uploaderTagCount)).toEqual([2, 30, undefined]);
  });

  it('skips the versions fetch when the user id is missing', async () => {
    const rl = makeSyncRateLimiter(async (url: string) => {
      const body = url.includes('status%3Aappealed')
        ? []
        : [{id: 1, rating: 'g', score: 5, tag_count_general: 20}];
      return {ok: true, status: 200, json: async () => body};
    });
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable()) as never,
      rl as never,
    );

    const previews = await adm.getRecentPostsPreview(
      makeSyncUser({id: undefined, name: 'tester'}),
      10,
    );
    expect(previews[0].uploaderTagCount).toBeUndefined();
    const urls = rl.fetch.mock.calls.map((c: [string]) => c[0]);
    expect(urls.some((u: string) => u.includes('/post_versions.json'))).toBe(
      false,
    );
  });
});

describe('getAbandonedPostIds — v1→v2 gap', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the posts whose v2 lands >= 15min after v1', async () => {
    const rl = makeSyncRateLimiter(async (url: string) => {
      const id = Number(url.match(/search\[post_id\]=(\d+)/)?.[1] ?? 0);
      let rows: unknown = [];
      if (id === 1) {
        rows = [
          {version: 1, created_at: '2024-01-01T00:00:00Z'},
          {version: 2, created_at: '2024-01-01T00:30:00Z'}, // 30min → abandoned
        ];
      } else if (id === 2) {
        rows = [
          {version: 1, created_at: '2024-01-01T00:00:00Z'},
          {version: 2, created_at: '2024-01-01T00:05:00Z'}, // 5min → race, not
        ];
      } else if (id === 3) {
        rows = [{version: 1, created_at: '2024-01-01T00:00:00Z'}]; // no v2 → not
      }
      return {ok: true, status: 200, json: async () => rows};
    });
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable()) as never,
      rl as never,
    );

    const abandoned = await adm.getAbandonedPostIds([1, 2, 3]);
    expect([...abandoned].sort()).toEqual([1]);
  });

  it('returns empty for empty input without fetching', async () => {
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable()) as never,
      rl as never,
    );
    const abandoned = await adm.getAbandonedPostIds([]);
    expect(abandoned.size).toBe(0);
    expect(rl.fetch).not.toHaveBeenCalled();
  });
});

describe('AnalyticsDataManager.getMilestones (count-stamped cache)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Three milestone posts with modern metadata (non-empty variants → the
  // getMilestones missing-thumbnail path never fires an API call). Their `no`
  // values line up with the auto-step targets for total=200 (1, 100, 200).
  const milestonePosts = [1, 100, 200].map(no => ({
    id: 1000 + no,
    uploader_id: 42,
    no,
    rating: 'g',
    score: 5,
    created_at: '2025-01-01T00:00:00Z',
    variants: [{type: '720x720', file_ext: 'webp', url: `http://x/${no}.webp`}],
    preview_file_url: `http://x/${no}.jpg`,
  }));

  /**
   * Wire a posts table whose milestone lookup (`anyOf().toArray()`) returns
   * `milestonePosts` but whose `.count()` reports `total` — the two are
   * decoupled so the stamp (count) can diverge from the returned rows.
   */
  function makeMilestoneDb(total: number) {
    const postsTable = makePostsTable(milestonePosts);
    (postsTable._chain.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      total,
    );
    return makeSyncDb(postsTable);
  }

  /** Seed piestats so the entries key and the sidecar `__count` key resolve. */
  function seedCache(
    db: ReturnType<typeof makeSyncDb>,
    entries: unknown,
    stamp: number | null,
  ) {
    db.piestats.get = vi.fn(async ({key}: {key: string}) => {
      if (key === 'milestones_auto_0') return {data: entries};
      if (key === 'milestones_auto_0__count') {
        return stamp === null ? null : {data: stamp};
      }
      return null;
    }) as never;
  }

  it('recomputes when the stamped count no longer matches the live count', async () => {
    const db = makeMilestoneDb(200);
    // Cache was written when the user had 100 posts; they now have 200.
    seedCache(
      db,
      [{type: '#1 STALE', post: {id: 9, no: 1}, milestone: 1}],
      100,
    );
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(db as never, rl as never);

    const result = await adm.getMilestones(makeSyncUser(), false, 'auto');

    // Recomputed from live posts (3 targets) — not the single stale entry.
    expect(result).toHaveLength(3);
    expect(result.map(m => m.milestone)).toEqual([1, 100, 200]);
    // No missing-thumbnail API calls for modern posts.
    expect(rl.fetch).not.toHaveBeenCalled();
    // Sidecar stamp rewritten with the fresh count.
    expect(db.piestats.put).toHaveBeenCalledWith(
      expect.objectContaining({key: 'milestones_auto_0__count', data: 200}),
    );
  });

  it('serves the cached entries when the stamp matches the live count', async () => {
    const db = makeMilestoneDb(200);
    seedCache(db, [{type: '#CACHED', post: {id: 7, no: 1}, milestone: 1}], 200);
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(db as never, rl as never);

    const result = await adm.getMilestones(makeSyncUser(), false, 'auto');

    // Returned straight from cache — no recompute, no save.
    expect(result).toEqual([
      {type: '#CACHED', post: {id: 7, no: 1}, milestone: 1},
    ]);
    expect(db.piestats.put).not.toHaveBeenCalled();
    expect(db.posts._chain.anyOf).not.toHaveBeenCalled();
  });

  it('treats a legacy stampless cache as a miss and recomputes', async () => {
    const db = makeMilestoneDb(200);
    // Pre-stamp cache: entries present, no `__count` sidecar.
    seedCache(db, [{type: '#OLD', post: {id: 5, no: 1}, milestone: 1}], null);
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(db as never, rl as never);

    const result = await adm.getMilestones(makeSyncUser(), false, 'auto');

    expect(result).toHaveLength(3);
    expect(db.piestats.put).toHaveBeenCalledWith(
      expect.objectContaining({key: 'milestones_auto_0__count', data: 200}),
    );
  });
});

describe('AnalyticsDataManager.refreshCriticalStats', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // The critical (cheap, must-be-fresh-on-first-paint) getters
  // refreshCriticalStats fans out to.
  const CRITICAL_GETTERS = [
    'getStatusDistribution',
    'getRatingDistribution',
    'getLevelChangeHistory',
    'getMilestones',
    'getTopPostsByType',
    'getRecentPopularPosts',
  ] as const;

  // Heavy tag-distribution / tag-cloud getters that were REMOVED from the
  // blocking sync path — they now freshen post-paint via fetchDashboardData's
  // SWR revalidate. getRandomPosts was dropped entirely (result never read).
  // The whole latency win (audit H-2 / R2 / L-1) depends on these NOT firing
  // inside refreshCriticalStats.
  const DEFERRED_GETTERS = [
    'getCharacterDistribution',
    'getCopyrightDistribution',
    'getFavCopyrightDistribution',
    'getBreastsDistribution',
    'getHairLengthDistribution',
    'getHairColorDistribution',
    'getTagCloudData',
    'getRandomPosts',
  ] as const;

  // Stubbed so the method's own orchestration is what's under test, not the
  // getters' internals. Both groups are spied so no real fetch escapes.
  function spyAllGetters(adm: AnalyticsDataManager) {
    const target = adm as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    const spies: Record<string, ReturnType<typeof vi.spyOn>> = {};
    for (const m of [...CRITICAL_GETTERS, ...DEFERRED_GETTERS]) {
      spies[m] = vi.spyOn(target, m).mockResolvedValue(undefined);
    }
    return spies;
  }

  it('refreshes popular posts on a PARTIAL sync (isFullSync=false) — v9.7.2 contract', async () => {
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      makeSyncRateLimiter() as never,
    );
    const spies = spyAllGetters(adm);

    await adm.refreshCriticalStats(makeSyncUser(), false);

    // The whole point of v9.7.2: these fire with forceRefresh=true even when
    // it is NOT a full sync (they used to be gated behind isFullSync).
    expect(spies.getTopPostsByType).toHaveBeenCalledWith(
      expect.anything(),
      true,
    );
    expect(spies.getRecentPopularPosts).toHaveBeenCalledWith(
      expect.anything(),
      true,
    );
  });

  it('also refreshes popular posts on a FULL sync', async () => {
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      makeSyncRateLimiter() as never,
    );
    const spies = spyAllGetters(adm);

    await adm.refreshCriticalStats(makeSyncUser(), true);

    expect(spies.getTopPostsByType).toHaveBeenCalled();
    expect(spies.getRecentPopularPosts).toHaveBeenCalled();
  });

  it('refreshes the full critical set (counts, level, milestones×2, popular)', async () => {
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      makeSyncRateLimiter() as never,
    );
    const spies = spyAllGetters(adm);

    await adm.refreshCriticalStats(makeSyncUser(), true);

    for (const g of CRITICAL_GETTERS) {
      expect(
        spies[g],
        `${g} should fire in critical refresh`,
      ).toHaveBeenCalled();
    }
  });

  it('does NOT refresh heavy tag distributions / random (deferred to SWR — R2/L-1)', async () => {
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      makeSyncRateLimiter() as never,
    );
    const spies = spyAllGetters(adm);

    await adm.refreshCriticalStats(makeSyncUser(), true);

    for (const g of DEFERRED_GETTERS) {
      expect(
        spies[g],
        `${g} must NOT fire on the blocking sync path`,
      ).not.toHaveBeenCalled();
    }
  });
});
