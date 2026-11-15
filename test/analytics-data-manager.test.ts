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
  classifySyncFetchError,
  syncRetryDelayMs,
  SYNC_PAGE_MAX_ATTEMPTS,
  SYNC_SEGMENT_PAGES,
  SYNC_WORKERS,
  SYNC_BUFFER_MAX_PAGES,
  splitIdRanges,
  isStaleUser,
  catchUpWatermark,
} from '../src/core/analytics-data-manager';
import {resetTopLevelSessionCache} from '../src/core/top-level-tags';

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
    // Records the predicate instead of ignoring it, so `primaryKeys()` can
    // answer faithfully (pruneGhostPosts filters then reads primary keys).
    // Terminal ops that predate this (count/toArray) keep their old
    // filter-blind behaviour so existing expectations are untouched.
    filter: vi.fn(),
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
    // [uploader_id+no] range read of the numbering check (T-404): the row
    // with the highest `no`.
    between: vi.fn(),
    last: vi.fn(async () =>
      rows.reduce<Record<string, unknown> | undefined>(
        (best, r) =>
          best === undefined || (r.no as number) > (best.no as number)
            ? r
            : best,
        undefined,
      ),
    ),
    delete: vi.fn(async () => rows.length),
    uniqueKeys: vi.fn(async () => []),
    orderBy: vi.fn().mockReturnThis(),
    _filters: [] as Array<(row: Record<string, unknown>) => boolean>,
    primaryKeys: vi.fn(async () =>
      rows
        .filter(r =>
          (
            chain._filters as Array<(row: Record<string, unknown>) => boolean>
          ).every(f => f(r)),
        )
        .map(r => r['id']),
    ),
  };
  chain.filter = vi.fn((fn: (row: Record<string, unknown>) => boolean) => {
    (chain._filters as Array<(row: Record<string, unknown>) => boolean>).push(
      fn,
    );
    return chain;
  });
  // Make all modifier fns return the chain itself
  (chain.reverse as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.limit as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.until as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.equals as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.anyOf as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  (chain.between as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

/** Build a posts table mock. */
function makePostsTable(rows: Record<string, unknown>[] = []) {
  const chain = makePostsChain(rows);
  // Each where() starts a fresh query, so recorded filter predicates from a
  // previous one must not leak into it.
  const startQuery = () => {
    chain._filters = [];
    return chain;
  };
  return {
    where: vi.fn(startQuery),
    orderBy: vi.fn(startQuery),
    bulkPut: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => undefined),
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
      delete: vi.fn(async () => undefined),
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
      bulkGet: vi.fn(async (keys: string[]) => keys.map(() => undefined)),
      bulkPut: vi.fn(async () => undefined),
    },
    transaction: vi.fn(
      async (_mode: string, _tables: unknown[], cb: () => Promise<void>) => {
        await cb();
      },
    ),
    ...overrides,
  };
}

/**
 * A standard test user for sync tests. Its join date is unknown (an
 * invalid Date), so a sync from the start searches `id:>0` without the
 * first-post lookup (T-508); the T-508 tests give one.
 */
function makeSyncUser(overrides: Partial<TargetUser> = {}): TargetUser {
  return {
    name: 'test_user',
    normalizedName: 'test_user',
    id: '42',
    created_at: '2020-01-01T00:00:00Z',
    joinDate: new Date(NaN),
    level_string: 'Member',
    ...overrides,
  };
}

/** The fetch of {@link makeSyncRateLimiter}: one URL, a Response-like reply. */
type SyncFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: {get(name: string): string | null};
}>;

/** Build a minimal rate-limiter mock for syncAllPosts tests. */
function makeSyncRateLimiter(fetchImpl?: SyncFetch) {
  const defaultFetch: SyncFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [],
  });
  return {
    fetch: vi.fn<SyncFetch>(fetchImpl ?? defaultFetch),
    getRequestCount: vi.fn(() => 0),
    backoffRemainingMs: vi.fn(() => 0),
    trafficSummary: vi.fn(() => ({
      edge429s: 0,
      peakOk: {sent1s: 0, sent10s: 0, sent60s: 0, sent120s: 0},
    })),
  };
}

describe('classifySyncFetchError', () => {
  it('treats 429 as a rate-limit retry', () => {
    expect(classifySyncFetchError(new Error('HTTP 429'))).toBe('rate-limit');
  });

  it('treats 5xx, timeouts, network drops and bad JSON as transient', () => {
    expect(classifySyncFetchError(new Error('HTTP 500'))).toBe('transient');
    expect(classifySyncFetchError(new Error('HTTP 503'))).toBe('transient');
    const abort = Object.assign(new Error('aborted'), {name: 'AbortError'});
    expect(classifySyncFetchError(abort)).toBe('transient');
    // DOMException-shaped object that is not an Error instance.
    expect(classifySyncFetchError({name: 'AbortError', message: 'x'})).toBe(
      'transient',
    );
    expect(classifySyncFetchError(new TypeError('Failed to fetch'))).toBe(
      'transient',
    );
    expect(classifySyncFetchError(new SyntaxError('Unexpected token <'))).toBe(
      'transient',
    );
  });

  it('treats other 4xx and unknown errors as fatal', () => {
    expect(classifySyncFetchError(new Error('HTTP 400'))).toBe('fatal');
    expect(classifySyncFetchError(new Error('HTTP 403'))).toBe('fatal');
    expect(classifySyncFetchError(new Error('something else'))).toBe('fatal');
    expect(classifySyncFetchError('HTTP 5000 widgets')).toBe('fatal');
  });
});

describe('syncRetryDelayMs', () => {
  it('backs off exponentially for transient errors', () => {
    expect([1, 2, 3, 4].map(n => syncRetryDelayMs('transient', n))).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });

  it('waits out the server-derived limiter pause on a 429', () => {
    // 31.5 s is what X-Rate-Limit yields at points=-30, rate=1, cost=1.
    expect(syncRetryDelayMs('rate-limit', 1, 31_500)).toBe(31_500);
    expect(syncRetryDelayMs('rate-limit', 4, 2_000)).toBe(2_000);
  });

  it('still waits at least 1 s on a 429 with no pause left', () => {
    expect(syncRetryDelayMs('rate-limit', 1, 0)).toBe(1000);
  });

  it('never lets a transient retry land inside a limiter pause', () => {
    expect(syncRetryDelayMs('transient', 1, 12_000)).toBe(12_000);
  });
});

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

  describe('carryOverThumbs', () => {
    it('reuses cached thumbs so a forced refresh refetches only new tags', async () => {
      // L-2 guard. A forced refresh rebuilds the distribution with thumb:null,
      // so enrichThumbnails used to re-derive a representative post for every
      // top-10 entry — 30-50 requests a sync for pictures that had not changed.
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable()) as never,
        makeSyncRateLimiter() as never,
      );
      vi.spyOn(adm, 'getStats').mockResolvedValue([
        {name: 'idolmaster', tagName: 'idolmaster', count: 9, thumb: 'a.jpg'},
        {name: 'touhou', tagName: 'touhou', count: 8, thumb: 'b.jpg'},
        {name: 'Others', tagName: '', count: 1, thumb: '', isOther: true},
      ] as never);

      const fresh = [
        {name: 'idolmaster', tagName: 'idolmaster', count: 11, thumb: null},
        {name: 'touhou', tagName: 'touhou', count: 8, thumb: 'kept.jpg'},
        {name: 'newcomer', tagName: 'newcomer', count: 5, thumb: null},
        {name: 'Others', tagName: '', count: 2, thumb: null, isOther: true},
      ];
      await (
        adm as unknown as {
          carryOverThumbs: (
            k: string,
            u: number,
            i: unknown[],
          ) => Promise<void>;
        }
      ).carryOverThumbs('copyright_dist', 42, fresh);

      // Carried over by tag, leaving the refreshed counts alone.
      expect(fresh[0].thumb).toBe('a.jpg');
      // An already-present thumb is never overwritten.
      expect(fresh[1].thumb).toBe('kept.jpg');
      // A tag with no cached entry still needs a real fetch.
      expect(fresh[2].thumb).toBeNull();
      // "Others" is a synthetic bucket and never carries a picture.
      expect(fresh[3].thumb).toBeNull();
    });

    it('is a no-op when there is no cached distribution yet', async () => {
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable()) as never,
        makeSyncRateLimiter() as never,
      );
      vi.spyOn(adm, 'getStats').mockResolvedValue(null as never);

      const fresh = [{name: 'a', tagName: 'a', count: 1, thumb: null}];
      await (
        adm as unknown as {
          carryOverThumbs: (
            k: string,
            u: number,
            i: unknown[],
          ) => Promise<void>;
        }
      ).carryOverThumbs('copyright_dist', 42, fresh);

      expect(fresh[0].thumb).toBeNull();
    });
  });

  describe('parseUploadCountFromDom', () => {
    // Minimal fake of the DOM surface the parser touches: rows with a <th>
    // label and a <td> whose count usually sits inside an <a>.
    type FakeEl = {
      textContent: string;
      querySelector: (sel: string) => FakeEl | null;
      querySelectorAll: (sel: string) => FakeEl[];
    };
    const el = (
      text: string,
      children: Record<string, FakeEl[]> = {},
    ): FakeEl => ({
      textContent: text,
      querySelector: sel => children[sel]?.[0] ?? null,
      querySelectorAll: sel => children[sel] ?? [],
    });
    const row = (label: string, value: string, link = true): FakeEl =>
      el(`${label} ${value}`, {
        th: [el(label)],
        td: [el(value, link ? {a: [el(value)]} : {})],
      });
    const stubTable = (rows: FakeEl[]) =>
      vi.stubGlobal('document', {
        querySelectorAll: (sel: string) =>
          sel === '#danbooru-grass-wrapper table tr' ? rows : [],
        querySelector: () => null,
      });
    const parse = (adm: AnalyticsDataManager) =>
      (
        adm as unknown as {parseUploadCountFromDom: () => number}
      ).parseUploadCountFromDom();

    it('reads the "Uploads" row — not "Upload Limit" or "Deleted Uploads"', () => {
      // M-4 guard. The profile statistics table also carries an
      // "Upload Limit" row; a substring match on 'upload' returned the
      // account's upload allowance (a tiny number) as its total post count,
      // and Number.isFinite happily accepted it.
      stubTable([
        row('Upload Limit', '10 / 15', false),
        row('Uploads', '46,252'),
        row('Deleted Uploads', '1,203'),
      ]);
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable()) as never,
        makeSyncRateLimiter() as never,
      );
      expect(parse(adm)).toBe(46252);
    });

    it('returns NaN when no row matches and the positional fallback misses', () => {
      // The caller guards with Number.isFinite and falls through to 0
      // ("could not determine") — never a NaN that poisons isSynced checks.
      stubTable([row('Favorites', '99')]);
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable()) as never,
        makeSyncRateLimiter() as never,
      );
      expect(Number.isNaN(parse(adm))).toBe(true);
    });
  });

  describe('getTotalPostCount memo', () => {
    it("collapses one interaction's repeated lookups onto a single request", async () => {
      // L-3 guard. A report click asks for the total from the pre-check, the
      // sync, the header status and three distributions; fetchRemoteCount has no
      // cache, so each was its own 400-900ms count query.
      const rl = makeSyncRateLimiter(async () => ({
        ok: true,
        status: 200,
        json: async () => ({counts: {posts: 1234}}),
      }));
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable()) as never,
        rl as never,
      );
      const user = makeSyncUser({id: '42'});

      const results = await Promise.all([
        adm.getTotalPostCount(user),
        adm.getTotalPostCount(user),
        adm.getTotalPostCount(user),
      ]);

      expect(results).toEqual([1234, 1234, 1234]);
      expect(rl.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not remember a failed lookup', async () => {
      // 0 means "could not determine", not "this user has no posts" — caching it
      // would strand the dashboard on a bad answer for the whole memo window.
      let call = 0;
      const rl = makeSyncRateLimiter(async () => {
        call++;
        if (call === 1) return {ok: false, status: 500, json: async () => ({})};
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 7}}),
        };
      });
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable()) as never,
        rl as never,
      );
      // No id → the profile fallback is skipped too, so the first call yields 0.
      const user = makeSyncUser({id: undefined});

      expect(await adm.getTotalPostCount(user)).toBe(0);
      expect(await adm.getTotalPostCount(user)).toBe(7);
    });

    it('keys the memo per user even when the id is an empty string', async () => {
      // The grass renderer synthesises `{name, id: ''}` for its legacy string
      // user form. `??` treats '' as a present id, so every such user collapsed
      // onto one memo entry and the second one read the first one's count.
      const rl = makeSyncRateLimiter(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => ({counts: {posts: url.includes('alice') ? 11 : 22}}),
      }));
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable()) as never,
        rl as never,
      );

      const alice = makeSyncUser({id: '', name: 'alice'});
      const bob = makeSyncUser({id: '', name: 'bob'});
      expect(await adm.getTotalPostCount(alice)).toBe(11);
      expect(await adm.getTotalPostCount(bob)).toBe(22);
    });
  });

  it('returns early without touching db when userInfo.id is missing', async () => {
    const postsTable = makePostsTable();
    const db = makeSyncDb(postsTable);
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(db as never, rl as never);

    const progress = vi.fn();
    const outcome = await adm.syncAllPosts(
      makeSyncUser({id: undefined}),
      progress,
    );

    expect(postsTable.where).not.toHaveBeenCalled();
    expect(rl.fetch).not.toHaveBeenCalled();
    // Nothing ran, so there is no partial data to warn about — callers must be
    // able to tell this apart from a run that fetched some of the pages.
    expect(outcome).toEqual({complete: false, started: false});
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
    const outcome = await adm.syncAllPosts(makeSyncUser(), progress);

    // Nothing should happen — lock was already held
    expect(postsTable.where).not.toHaveBeenCalled();
    expect(rl.fetch).not.toHaveBeenCalled();
    // Blocked before fetching anything: not a partial sync.
    expect(outcome).toEqual({complete: false, started: false});
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

  it('logs the traffic the edge saw during the sync when it ends (T-209)', async () => {
    const postsTable = makePostsTable([]);
    postsTable.where.mockImplementation(() => {
      throw new Error('db read error');
    });
    const rl = makeSyncRateLimiter(async () => ({
      ok: true,
      status: 200,
      json: async () => ({counts: {posts: 5}}),
    }));
    // Two edge 429s before this sync, five after: three are its own.
    rl.trafficSummary
      .mockReturnValueOnce({
        edge429s: 2,
        peakOk: {sent1s: 0, sent10s: 0, sent60s: 0, sent120s: 0},
      })
      .mockReturnValueOnce({
        edge429s: 5,
        peakOk: {sent1s: 6, sent10s: 40, sent60s: 170, sent120s: 300},
      });
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const adm = new AnalyticsDataManager(
      makeSyncDb(postsTable) as never,
      rl as never,
    );

    // Logged even when the run throws (finally).
    await expect(adm.syncAllPosts(makeSyncUser(), vi.fn())).rejects.toThrow();

    const call = info.mock.calls.find(c =>
      String(c[0]).includes('Sync traffic'),
    );
    expect(call?.[1]).toMatchObject({
      edge429s: 3,
      sent10s: 40,
      sent60s: 170,
      sent120s: 300,
      elapsedMs: expect.any(Number),
    });
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
    // A full sync's fields completion goes to sync_meta since T-403 (see
    // "fields version 2 and sync_meta"); the old flag is no longer written.
    const metaKeySet = ls.mock.calls.some(
      (c: string[]) => c[0] === 'di_post_metadata_v2_42',
    );
    expect(metaKeySet).toBe(false);

    // refreshCriticalStats was called; other users' cleanup is the app's,
    // after the dashboard is painted (T-503).
    expect(adm2.cleanupStaleData).not.toHaveBeenCalled();
    expect(adm2.refreshCriticalStats).toHaveBeenCalledWith(
      expect.objectContaining({id: '42'}),
      true, // full sync
    );

    // requestPersistence was called
    expect(quotaManager.requestPersistence).toHaveBeenCalled();
  });

  it('a failed page reports complete:false and skips the completion stamps', async () => {
    // M-2 guard. A worker that gives up stops quietly and leaves the DB
    // prefix-consistent, so Promise.all resolves normally. Before, that path
    // still stamped last-sync + the backfill-complete flag and the caller
    // painted a green "Synced" — the user saw a full-success UI over partial
    // data, and the completion stamp meant the resume never happened.
    const postsTable = makePostsTable([]);
    const db = makeSyncDb(postsTable);

    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 3}}),
        };
      }
      // HTTP 400 is not a 5xx, so the worker throws on the first attempt
      // instead of burning the retry backoff.
      return {ok: false, status: 400, json: async () => []};
    });

    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

    expect(outcome.complete).toBe(false);
    // It did run and did commit — this is the case that must warn, unlike the
    // two early returns above.
    expect(outcome.started).toBe(true);

    const ls = vi.mocked(localStorage.setItem);
    expect(
      ls.mock.calls.some((c: string[]) =>
        c[0].startsWith('danbooru_grass_last_sync_'),
      ),
    ).toBe(false);
    expect(
      ls.mock.calls.some((c: string[]) => c[0] === 'di_post_metadata_v2_42'),
    ).toBe(false);

    // Stats still refresh: what did commit is prefix-consistent and should be
    // reflected, so only the completion *claims* are withheld.
    expect(adm.refreshCriticalStats).toHaveBeenCalled();
    expect(AnalyticsDataManager.isGlobalSyncing).toBe(false);
  });

  // A 46k-post sync used to die at ~42k on a single HTTP 429: only 5xx
  // were retried, so the worker gave up on the first attempt and the user
  // landed on "Resume Sync". These pin the retry classes end to end.
  const onePost = [
    {
      id: 101,
      uploader_id: 42,
      created_at: '2024-01-01T00:00:00Z',
      up_score: 1,
      down_score: 0,
      rating: 'g',
    },
  ];

  function failFirstPageFetch(
    failure: () =>
      | never
      | Promise<never>
      | {
          ok: boolean;
          status: number;
          json: () => Promise<unknown>;
        },
  ) {
    let page1Calls = 0;
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 1}}),
        };
      }
      if (url.includes('page=1&')) {
        page1Calls++;
        if (page1Calls === 1) return failure();
        return {ok: true, status: 200, json: async () => onePost};
      }
      return {ok: true, status: 200, json: async () => []};
    });
    return {rl, page1Calls: () => page1Calls};
  }

  it.each([
    ['HTTP 429', () => ({ok: false, status: 429, json: async () => ({})})],
    [
      'a network drop',
      () => {
        throw new TypeError('NetworkError when attempting to fetch resource.');
      },
    ],
    [
      'the 30s timeout abort',
      () => {
        throw Object.assign(new Error('The operation was aborted.'), {
          name: 'AbortError',
        });
      },
    ],
  ])('retries a page after %s and completes', async (_label, failure) => {
    const db = makeSyncDb(makePostsTable([]));
    const {rl, page1Calls} = failFirstPageFetch(failure);
    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

    expect(page1Calls()).toBe(2);
    expect(outcome).toEqual({complete: true, started: true});
    expect(quotaManager.bulkPutSafe).toHaveBeenCalled();
  });

  it('a 429 retry waits for the rate limiter pause', async () => {
    const db = makeSyncDb(makePostsTable([]));
    const {rl} = failFirstPageFetch(() => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));
    rl.backoffRemainingMs.mockReturnValue(31_500);
    const waits: number[] = [];
    vi.stubGlobal('setTimeout', (fn: () => void, ms: number) => {
      waits.push(ms);
      fn();
    });
    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

    expect(outcome.complete).toBe(true);
    expect(rl.backoffRemainingMs).toHaveBeenCalled();
    expect(waits).toContain(31_500);
  });

  it('stops after SYNC_PAGE_MAX_ATTEMPTS when 429 persists', async () => {
    const db = makeSyncDb(makePostsTable([]));
    let page1Calls = 0;
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 1}}),
        };
      }
      if (url.includes('page=1&')) page1Calls++;
      return {ok: false, status: 429, json: async () => ({})};
    });
    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

    expect(page1Calls).toBe(SYNC_PAGE_MAX_ATTEMPTS);
    expect(outcome.complete).toBe(false);
  });

  it('a failed run reports the committed count, not total/total, when preparing', async () => {
    // The header used to read "46,894 / 46,894 (100%)" over a run that had
    // stopped thousands of posts short.
    const db = makeSyncDb(makePostsTable([]));
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 3}}),
        };
      }
      if (url.includes('page=1&')) {
        return {ok: true, status: 200, json: async () => onePost};
      }
      return {ok: false, status: 400, json: async () => ({})};
    });
    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const progress = vi.fn();
    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), progress);

    expect(outcome.complete).toBe(false);
    expect(progress).toHaveBeenCalledWith(1, 3, 'PREPARING');
    expect(progress).not.toHaveBeenCalledWith(3, 3, 'PREPARING');
  });

  it('clearUserData also drops the backfill-complete flag', async () => {
    const postsTable = makePostsTable([]);
    const db = makeSyncDb(postsTable);
    const adm = new AnalyticsDataManager(
      db as never,
      makeSyncRateLimiter() as never,
    );

    await adm.clearUserData(makeSyncUser({id: '42'}));

    expect(postsTable._chain.delete).toHaveBeenCalled();
    const removed = vi
      .mocked(localStorage.removeItem)
      .mock.calls.map((c: string[]) => c[0]);
    expect(removed).toContain('danbooru_grass_last_sync_42');
    expect(removed).toContain('di_post_metadata_v2_42');
  });

  // T-212: Danbooru answers 410 past the viewer's page limit (1000 below
  // Gold), which used to end a Member's sync of a >200k-upload account as
  // incomplete. The sync now re-anchors on `id:>` and counts pages from 1.
  describe('page-limit segments (T-212)', () => {
    /**
     * One post per page, ids 1..lastId, so a segment's pages are easy to
     * name. Pages past the limit answer 410 like Danbooru.
     */
    function servePostsUpTo(lastId: number) {
      const asked: string[] = [];
      const rl = makeSyncRateLimiter(async (url: string) => {
        if (url.includes('/counts/posts.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({counts: {posts: lastId}}),
          };
        }
        const q = new URLSearchParams(url.split('?')[1]);
        const page = Number(q.get('page'));
        const after = Number(/id:>(\d+)/.exec(q.get('tags') ?? '')?.[1]);
        asked.push(`${after}/${page}`);
        if (page > SYNC_SEGMENT_PAGES) {
          return {ok: false, status: 410, json: async () => ({})};
        }
        const id = after + page;
        const body =
          id <= lastId
            ? [
                {
                  id,
                  uploader_id: 42,
                  created_at: '2025-01-01T00:00:00Z',
                  up_score: 1,
                  down_score: 0,
                  rating: 'g',
                },
              ]
            : [];
        return {ok: true, status: 200, json: async () => body};
      });
      return {rl, asked};
    }

    async function runSync(rl: ReturnType<typeof makeSyncRateLimiter>) {
      // The pauses between pages are not under test.
      vi.stubGlobal('setTimeout', (fn: () => void) => fn());
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable([])) as never,
        rl as never,
      );
      vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
      vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();
      // One post a page (T-504): a shorter page would end the run.
      const outcome = await adm.syncAllPosts(
        makeSyncUser({id: '42'}),
        vi.fn(),
        {pageLimit: 1},
      );
      const written = vi
        .mocked(quotaManager.bulkPutSafe)
        .mock.calls.flatMap(c => c[1] as Array<{id: number; no: number}>);
      return {outcome, written};
    }

    it('continues past the page limit from the last post, numbering on', async () => {
      const lastId = SYNC_SEGMENT_PAGES + 3;
      const {rl, asked} = servePostsUpTo(lastId);

      const {outcome, written} = await runSync(rl);

      expect(outcome).toEqual({complete: true, started: true});
      // Never past the limit; the next segment starts after post 1000.
      expect(asked).not.toContain(`0/${SYNC_SEGMENT_PAGES + 1}`);
      expect(asked).toContain(`${SYNC_SEGMENT_PAGES}/1`);
      expect(written).toHaveLength(lastId);
      expect(written.every(r => r.no === r.id)).toBe(true);
    });

    it('an account that ends exactly on the limit finishes with one empty page', async () => {
      const {rl, asked} = servePostsUpTo(SYNC_SEGMENT_PAGES);

      const {outcome, written} = await runSync(rl);

      expect(outcome.complete).toBe(true);
      expect(written).toHaveLength(SYNC_SEGMENT_PAGES);
      // The full segment cannot tell it was the last: one more page says so.
      expect(asked).toContain(`${SYNC_SEGMENT_PAGES}/1`);
      expect(asked).not.toContain(`0/${SYNC_SEGMENT_PAGES + 1}`);
    });
  });

  // T-402: the sync asks for the fields the local pies need, and a run that
  // wrote all of a user's rows records that in sync_meta.
  describe('fields version 2 and sync_meta (T-402)', () => {
    const DATE = 'Sat, 14 Nov 2026 13:53:29 GMT';
    const apiPost = {
      id: 7,
      uploader_id: 42,
      created_at: '2026-11-01T10:00:00.000+09:00',
      updated_at: '2026-11-10T12:00:00.000+09:00',
      up_score: 3,
      down_score: -1,
      rating: 's',
      is_pending: true,
      is_flagged: false,
      tag_count: 31,
      tag_count_general: 20,
      tag_string_character: 'hakurei_reimu',
      tag_string_copyright: 'touhou',
    };

    function makeSyncMeta() {
      const rows = new Map<number, Record<string, unknown>>();
      return {
        rows,
        get: vi.fn(async (k: number) => rows.get(k)),
        put: vi.fn(async (r: Record<string, unknown>) => {
          rows.set(r.userId as number, r);
        }),
      };
    }

    /** One post on page 1, then an empty page; `failPage2` answers 400. */
    function serve(failPage2 = false) {
      const asked: string[] = [];
      const rl = makeSyncRateLimiter(async (url: string) => {
        if (url.includes('/counts/posts.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({counts: {posts: 1}}),
          };
        }
        asked.push(url);
        const q = new URLSearchParams(url.split('?')[1]);
        const first = q.get('page') === '1' || q.get('page') === 'a0';
        if (!first && failPage2) {
          return {ok: false, status: 400, json: async () => ({})};
        }
        return {
          ok: true,
          status: 200,
          json: async () => (first ? [apiPost] : []),
          headers: {get: (n: string) => (n === 'date' ? DATE : null)},
        };
      });
      return {rl, asked};
    }

    function setUp(
      rows: Record<string, unknown>[],
      rl: ReturnType<typeof makeSyncRateLimiter>,
    ) {
      vi.stubGlobal('setTimeout', (fn: () => void) => fn());
      vi.stubGlobal('document', {
        body: {dataset: {currentUserTimeZone: 'Seoul'}},
      });
      const syncMeta = makeSyncMeta();
      const adm = new AnalyticsDataManager(
        makeSyncDb(makePostsTable(rows), {sync_meta: syncMeta}) as never,
        rl as never,
      );
      vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
      vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();
      const written = () =>
        vi
          .mocked(quotaManager.bulkPutSafe)
          .mock.calls.flatMap(c => c[1] as Record<string, unknown>[]);
      return {adm, syncMeta, written};
    }

    it('asks for the tag fields, not variants, and stores them under short names', async () => {
      const {rl, asked} = serve();
      const {adm, written} = setUp([], rl);

      await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

      const only = new URLSearchParams(asked[0].split('?')[1]).get('only');
      expect(only?.split(',')).toEqual(
        expect.arrayContaining([
          'updated_at',
          'is_pending',
          'is_flagged',
          'tag_count',
          'tag_string_character',
          'tag_string_copyright',
        ]),
      );
      expect(only).not.toContain('variants');
      expect(written()[0]).toMatchObject({
        id: 7,
        no: 1,
        score: 2,
        upd: Date.parse('2026-11-10T12:00:00.000+09:00'),
        pend: true,
        flag: false,
        tc: 31,
        chr: 'hakurei_reimu',
        cpy: 'touhou',
      });
    });

    it('records fields version 2, the server time of the first page and the time zone after a sync from the start', async () => {
      const {rl} = serve();
      const {adm, syncMeta} = setUp([], rl);

      await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

      expect(syncMeta.rows.get(42)).toEqual({
        userId: 42,
        fieldsVersion: 2,
        changeWatermark: Date.parse(DATE),
        timeZone: 'Seoul',
      });
    });

    it('records no fields version after a run that failed, and keeps it marked as started', async () => {
      const {rl} = serve(true);
      const {adm, syncMeta} = setUp([], rl);

      const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

      expect(outcome.complete).toBe(false);
      expect(syncMeta.rows.get(42)).toEqual({
        userId: 42,
        syncStartedAt: expect.any(Number),
      });
    });

    it('records no fields version after a resume sync, which re-fetches only the last month', async () => {
      const {rl, asked} = serve();
      const {adm, syncMeta} = setUp(
        [
          {id: 900, uploader_id: 42, no: 2, created_at: '2025-03-01T00:00:00Z'},
          {id: 100, uploader_id: 42, no: 1, created_at: '2024-01-01T00:00:00Z'},
        ],
        rl,
      );

      await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

      expect(asked[0]).toContain(encodeURIComponent('id:>100'));
      const meta = syncMeta.rows.get(42);
      expect(meta?.fieldsVersion).toBeUndefined();
      expect(meta?.changeWatermark).toBeUndefined();
      // The run completed: no longer marked as under way (T-404).
      expect(meta?.syncStartedAt).toBeUndefined();
    });

    it('numbers a resume after the rows at or below its start (T-502)', async () => {
      const {rl, asked} = serve();
      // Newest first, as the reverse walk meets them: 500 is the first one
      // older than a month before the newest, so the resume starts after it.
      const {adm, written} = setUp(
        [
          {id: 950, uploader_id: 42, no: 4, created_at: '2025-03-10T00:00:00Z'},
          {id: 30, uploader_id: 42, no: 1, created_at: '2025-03-05T00:00:00Z'},
          {id: 60, uploader_id: 42, no: 2, created_at: '2025-03-02T00:00:00Z'},
          {id: 500, uploader_id: 42, no: 3, created_at: '2025-01-15T00:00:00Z'},
        ],
        rl,
      );
      vi.mocked(quotaManager.bulkPutSafe).mockClear();

      await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

      expect(asked[0]).toContain(encodeURIComponent('id:>500'));
      // 30, 60 and 500 are at or below the start: the next row is no 4.
      expect(written()[0]).toMatchObject({id: 7, no: 4});
    });

    it('records it after a quick sync, which always rewrites every row', async () => {
      const {rl} = serve();
      const {adm, syncMeta} = setUp([], rl);

      await adm.quickSyncAllPosts(makeSyncUser({id: '42'}));

      expect(syncMeta.rows.get(42)).toMatchObject({
        fieldsVersion: 2,
        changeWatermark: Date.parse(DATE),
      });
      // Other users' cleanup is the app's, after paint (T-503).
      expect(adm.cleanupStaleData).not.toHaveBeenCalled();
    });
  });

  it('a clean run reports complete:true', async () => {
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
      return {ok: true, status: 200, json: async () => []};
    });

    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());
    expect(outcome).toEqual({complete: true, started: true});
  });

  it('prunes rows the remote no longer returns after a clean run', async () => {
    // M-3 guard. Sync searches carry no `status:any`, so a post deleted on
    // Danbooru since the last run simply never appears in the re-fetched
    // window. Its local row used to survive with is_deleted:false while the
    // surviving posts were renumbered, so its stale `no` collided with a live
    // post's — milestones by [uploader_id+no] became ambiguous and the local
    // count drifted above the remote one.
    const ghost = {id: 900, uploader_id: 42, no: 7, created_at: '2025-01-02'};
    const live = {id: 901, uploader_id: 42, no: 8, created_at: '2025-01-03'};
    const postsTable = makePostsTable([ghost, live]);
    const db = makeSyncDb(postsTable);

    let postsCallCount = 0;
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 1}}),
        };
      }
      postsCallCount++;
      // Only the live post comes back; the ghost is gone remotely.
      if (postsCallCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 901,
              uploader_id: 42,
              created_at: '2025-01-03T00:00:00Z',
              up_score: 1,
              down_score: 0,
              rating: 'g',
            },
          ],
        };
      }
      return {ok: true, status: 200, json: async () => []};
    });

    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

    expect(outcome.complete).toBe(true);
    expect(postsTable.bulkDelete).toHaveBeenCalledWith([900]);
  });

  it('does not prune when the run was incomplete', async () => {
    // A failed run has not seen every page, so a row missing from the seen set
    // may just be one we never asked for. Pruning on that evidence would
    // delete live data — the whole reason the reconcile runs after the fetch
    // rather than as a delete-then-refetch before it.
    const ghost = {id: 900, uploader_id: 42, no: 7, created_at: '2025-01-02'};
    const postsTable = makePostsTable([ghost]);
    const db = makeSyncDb(postsTable);

    let postsCallCount = 0;
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 2}}),
        };
      }
      postsCallCount++;
      if (postsCallCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 901,
              uploader_id: 42,
              created_at: '2025-01-03T00:00:00Z',
              up_score: 1,
              down_score: 0,
              rating: 'g',
            },
          ],
        };
      }
      // A later page dies (400 is not a 5xx → no retry backoff).
      return {ok: false, status: 400, json: async () => []};
    });

    const adm = new AnalyticsDataManager(db as never, rl as never);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();

    const outcome = await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

    expect(outcome.complete).toBe(false);
    expect(postsTable.bulkDelete).not.toHaveBeenCalled();
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
      // Batched: one row per variant among the comma-joined names.
      const m = url.match(/antecedent_name_comma\]=([^&]+)/);
      const names = m ? decodeURIComponent(m[1]).split(',') : [];
      const rows = names
        .filter(n => tagByName.get(n)?.isTopLevel === false)
        .map(n => ({antecedent_name: n, consequent_name: 'base'}));
      return {ok: true, status: 200, json: async () => rows};
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
    resetTopLevelSessionCache();
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

    // charPoolSize returns raw=15 for small users — one batched lookup
    // covers all 15 (was one request per candidate).
    const impCalls = rl.fetch.mock.calls.filter((c: [string]) =>
      c[0].startsWith('/tag_implications.json'),
    );
    expect(impCalls.length).toBe(1);
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

// A 429 on one candidate's count used to leave it at 0: it fell out of the
// top 10 (Noa missing from a Blue Archive uploader's character pie) and that
// ranking was cached. Counts now retry once; a count still lost blocks the
// cache write.
describe('getCharacterDistribution — lost counts', () => {
  beforeEach(() => {
    resetTopLevelSessionCache();
    vi.stubGlobal('window', {
      location: {origin: 'https://danbooru.donmai.us'},
      dispatchEvent: vi.fn(),
    });
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

  const script: FetchScript = {
    totalPostCount: 50_000,
    related: [
      {
        name: 'noa_(blue_archive)',
        frequency: 0.03,
        isTopLevel: true,
        count: 900,
      },
      {
        name: 'yuuka_(blue_archive)',
        frequency: 0.04,
        isTopLevel: true,
        count: 700,
      },
      {
        name: 'aru_(blue_archive)',
        frequency: 0.02,
        isTopLevel: true,
        count: 500,
      },
    ],
  };
  const user = makeSyncUser({id: '42', name: 'tester'});

  /** Fails Noa's count with `status` the first `times` attempts. */
  function failingNoa(status: number, times: number) {
    const base = buildDistFetch(script, 'user');
    let failures = 0;
    return async (url: string) => {
      if (
        url.startsWith('/counts/posts.json') &&
        decodeURIComponent(url).includes('noa_(blue_archive)') &&
        failures < times
      ) {
        failures++;
        return {ok: false, status, json: async () => ({})};
      }
      return base(url);
    };
  }

  it('a count that 429s once is retried, ranked and cached', async () => {
    const {adm} = makeDistAdm(failingNoa(429, 1), 50_000);
    const save = vi.spyOn(adm, 'saveStats');

    const result = await adm.getCharacterDistribution(user);

    expect(result[0].tagName).toBe('noa_(blue_archive)');
    expect(result[0].count).toBe(900);
    expect(save).toHaveBeenCalledWith('character_dist', 42, result);
  });

  it('a count lost after its retry is shown but not cached', async () => {
    const {adm} = makeDistAdm(failingNoa(429, 2), 50_000);
    const save = vi.spyOn(adm, 'saveStats');

    const result = await adm.getCharacterDistribution(user);

    expect(save).not.toHaveBeenCalled();
    expect(result.map(r => r.tagName)).toContain('yuuka_(blue_archive)');
  });

  it('a lost count falls back to the previous cached ranking', async () => {
    const {adm, rl} = makeDistAdm(failingNoa(503, 2), 50_000);
    const previous = [
      {name: 'noa (blue archive)', tagName: 'noa_(blue_archive)', count: 880},
    ];
    vi.spyOn(adm, 'getStats').mockResolvedValue(previous);
    const save = vi.spyOn(adm, 'saveStats');

    const result = await adm.getCharacterDistribution(user, true);

    expect(save).not.toHaveBeenCalled();
    expect(result).toBe(previous);
    // It really fetched (forceRefresh), rather than returning the cache early.
    expect(rl.fetch).toHaveBeenCalled();
  });

  it('thumbnails for an uncached partial result reach the pie but not the cache', async () => {
    const {adm} = makeDistAdm(buildDistFetch(script, 'user'), 50_000);
    vi.mocked(adm.enrichThumbnails).mockRestore();
    vi.spyOn(adm, 'fetchThumbnailWithRetry').mockResolvedValue('t.webp');
    const save = vi.spyOn(adm, 'saveStats');
    const items = [{name: 'noa', tagName: 'noa_(blue_archive)', count: 1}];

    await adm.enrichThumbnails(
      'character_dist',
      42,
      items as never,
      user,
      null,
      false,
    );

    expect(items[0]).toHaveProperty('thumb', 't.webp');
    expect(save).not.toHaveBeenCalled();
    expect(window.dispatchEvent).toHaveBeenCalled();
  });

  it('a deterministic 4xx is not retried and does not block caching', async () => {
    // e.g. 422 for a search over a Member account's tag limit: refetching
    // cannot change it, so refusing to cache would re-run it every open.
    const fetchImpl = failingNoa(422, 99);
    const {adm, rl} = makeDistAdm(fetchImpl, 50_000);
    const save = vi.spyOn(adm, 'saveStats');

    await adm.getCharacterDistribution(user);

    const noaCalls = rl.fetch.mock.calls.filter(
      (c: [string]) =>
        c[0].startsWith('/counts/posts.json') &&
        decodeURIComponent(c[0]).includes('noa_(blue_archive)'),
    );
    expect(noaCalls).toHaveLength(1);
    expect(save).toHaveBeenCalled();
  });

  it('a null count is not retried and not cached (DA-20)', async () => {
    // Danbooru caches a timed-out count's null for 5 minutes, so a retry
    // only reads it back; it used to read as 0 and drop Noa from the pie.
    const base = buildDistFetch(script, 'user');
    const fetchImpl = async (url: string) =>
      url.startsWith('/counts/posts.json') &&
      decodeURIComponent(url).includes('noa_(blue_archive)')
        ? {ok: true, status: 200, json: async () => ({counts: {posts: null}})}
        : base(url);
    const {adm, rl} = makeDistAdm(fetchImpl, 50_000);
    const save = vi.spyOn(adm, 'saveStats');

    await adm.getCharacterDistribution(user);

    const noaCalls = rl.fetch.mock.calls.filter(
      (c: [string]) =>
        c[0].startsWith('/counts/posts.json') &&
        decodeURIComponent(c[0]).includes('noa_(blue_archive)'),
    );
    expect(noaCalls).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });
});

// A count that cannot be had — 422 over the viewer's tag limit, a null, a
// lost request — used to read as 0: a slice vanished, or an inclusion-
// exclusion went on with a fake 0. It is now an `unknown` slice (G-4).
describe('count distributions — unknown slices (T-204)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {origin: 'https://danbooru.donmai.us'},
      dispatchEvent: vi.fn(),
    });
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

  const user = makeSyncUser({id: '42', name: 'tester'});

  /**
   * Answers each count from `counts` by its decoded `tags`; a number is the
   * count, `null` a timed-out count, a string `'422'` / `'429'` that status.
   * Unlisted queries count 0.
   */
  function makeCountAdm(counts: Record<string, number | null | string>) {
    const rl = makeSyncRateLimiter(async (url: string) => {
      const tags = new URLSearchParams(url.split('?')[1]).get('tags') ?? '';
      const v = tags in counts ? counts[tags] : 0;
      if (typeof v === 'string') {
        return {ok: false, status: Number(v), json: async () => ({})};
      }
      return {ok: true, status: 200, json: async () => ({counts: {posts: v}})};
    });
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      rl as never,
    );
    vi.spyOn(adm, 'getStats').mockResolvedValue(null);
    vi.spyOn(
      adm as unknown as {enrichThumbnails: () => Promise<void>},
      'enrichThumbnails',
    ).mockResolvedValue();
    const save = vi.spyOn(adm, 'saveStats').mockResolvedValue();
    return {adm, rl, save};
  }

  it('commentary: a 422 slice is kept as unknown and the run is cached', async () => {
    const {adm, save} = makeCountAdm({
      'user:tester commentary': 40,
      'user:tester commentary_request': 10,
      'user:tester has:commentary': 70,
      'user:tester has:commentary commentary': '422',
    });

    const result = await adm.getCommentaryDistribution(user);

    const untagged = result.find(r => r.name === 'Untagged');
    expect(untagged).toMatchObject({count: 0, unknown: true});
    expect(result.find(r => r.name === 'Commentary')?.count).toBe(40);
    // 422 is deterministic: caching the unknown saves re-asking every open.
    expect(save).toHaveBeenCalledWith('commentary_dist', 42, result);
  });

  // T-408: "Untagged" from three counts instead of one 4-term search, and
  // a slice over the viewer's tag limit is not asked but shown locked.
  it('commentary: Untagged is has:commentary minus its two tagged parts', async () => {
    const {adm, rl} = makeCountAdm({
      'user:tester commentary': 40,
      'user:tester commentary_request': 10,
      'user:tester has:commentary': 100,
      'user:tester has:commentary commentary': 40,
      'user:tester has:commentary commentary_request': 10,
    });

    const result = await adm.getCommentaryDistribution(user);

    expect(result.find(r => r.name === 'Untagged')?.count).toBe(50);
    const asked = rl.fetch.mock.calls.map(c =>
      new URLSearchParams(c[0].split('?')[1]).get('tags'),
    );
    expect(asked).not.toContain(
      'user:tester has:commentary -commentary -commentary_request',
    );
  });

  it.each([
    ['0', true],
    ['20', false],
  ])(
    'viewer level %s: the 3-term slices are locked and not asked = %s',
    async (level, locked) => {
      vi.stubGlobal('document', {body: {dataset: {currentUserLevel: level}}});
      const {adm, rl} = makeCountAdm({
        'user:tester commentary': 40,
        'user:tester has:commentary': 100,
        'user:tester ~bald ~bald_female': 3,
      });

      const commentary = await adm.getCommentaryDistribution(user);
      const translation = await adm.getTranslationDistribution(user);
      const hair = await adm.getHairLengthDistribution(user);

      const asked = rl.fetch.mock.calls.map(
        c => new URLSearchParams(c[0].split('?')[1]).get('tags') ?? '',
      );
      const threeTerm = asked.filter(q => q.split(' ').length > 2);
      if (locked) {
        expect(threeTerm).toEqual([]);
        for (const pie of [commentary, translation, hair]) {
          const lockedSlice = pie.find(r => r.locked);
          expect(lockedSlice).toMatchObject({unknown: true, locked: true});
        }
        // The 2-term slices are still counted.
        expect(commentary.find(r => r.name === 'Commentary')?.count).toBe(40);
      } else {
        expect(threeTerm.length).toBeGreaterThan(0);
        for (const pie of [commentary, translation, hair]) {
          expect(pie.some(r => r.locked)).toBe(false);
        }
      }
    },
  );

  it('commentary: a null slice is unknown and the run is not cached', async () => {
    const {adm, save} = makeCountAdm({
      'user:tester commentary': null,
      'user:tester commentary_request': 10,
    });

    const result = await adm.getCommentaryDistribution(user);

    expect(result.find(r => r.name === 'Commentary')).toMatchObject({
      unknown: true,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('translation: one lost inclusion-exclusion term leaves Untagged unknown', async () => {
    // Before: the 422 read as 0, so t − a − b − c + ab + ac ran with ab = 0
    // and showed a made-up Untagged count.
    const {adm} = makeCountAdm({
      'user:tester translated': 30,
      'user:tester translation_request': 5,
      'user:tester *_text': 100,
      'user:tester english_text': 10,
      'user:tester *_text translation_request': 5,
      'user:tester *_text translated': 30,
      'user:tester english_text translation_request': '422',
      'user:tester english_text translated': 2,
    });

    const result = await adm.getTranslationDistribution(user);

    const untagged = result.find(r => r.name === 'Untagged');
    expect(untagged).toMatchObject({count: 0, unknown: true});
    expect(result.find(r => r.name === 'Translated')?.count).toBe(30);
  });

  it('translation: with every term in, Untagged is computed', async () => {
    const {adm} = makeCountAdm({
      'user:tester translated': 30,
      'user:tester *_text': 100,
      'user:tester english_text': 10,
      'user:tester *_text translation_request': 5,
      'user:tester *_text translated': 30,
      'user:tester english_text translation_request': 1,
      'user:tester english_text translated': 2,
    });

    const result = await adm.getTranslationDistribution(user);

    // 100 − 10 − 5 − 30 + 1 + 2 = 58
    expect(result.find(r => r.name === 'Untagged')).toMatchObject({
      count: 58,
    });
    expect(result.find(r => r.name === 'Untagged')?.unknown).toBeUndefined();
  });

  it('hair length: a 422 "Bald" is unknown, the rest is unchanged', async () => {
    const {adm} = makeCountAdm({
      'user:tester ~bald ~bald_female': '422',
      'user:tester long_hair': 70,
      'user:tester short_hair': 20,
    });

    const result = await adm.getHairLengthDistribution(user);

    expect(result.find(r => r.name === 'Bald')).toMatchObject({
      count: 0,
      unknown: true,
    });
    expect(result.find(r => r.name === 'Long Hair')?.count).toBe(70);
    // Zero-count buckets still drop out as before.
    expect(result.find(r => r.name === 'Medium Hair')).toBeUndefined();
  });

  it('user stats: a lost count is not stored as 0', async () => {
    const userStats = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const rl = makeSyncRateLimiter(async (url: string) =>
      url.includes('gentags')
        ? {ok: true, status: 200, json: async () => ({counts: {posts: null}})}
        : {ok: true, status: 200, json: async () => ({counts: {posts: 3}})},
    );
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([]), {user_stats: userStats}) as never,
      rl as never,
    );

    expect(await adm.getUserStats(user)).toBeNull();
    expect(userStats.put).not.toHaveBeenCalled();
  });
});

// Pie slice thumbnails are `user:X <tag> order:score rating:g`: 3 terms, 4
// for Hair "Bald". Over the viewer's limit they can only 422, so they are
// not sent (T-204 item 8).
describe('enrichThumbnails — viewer tag limit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setViewerLevel(level: string) {
    vi.stubGlobal('window', {
      location: {origin: 'https://danbooru.donmai.us'},
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('document', {body: {dataset: {currentUserLevel: level}}});
  }

  async function thumbQueries(level: string): Promise<string[]> {
    setViewerLevel(level);
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      makeSyncRateLimiter() as never,
    );
    const fetchThumb = vi
      .spyOn(adm, 'fetchThumbnailWithRetry')
      .mockResolvedValue('t.webp');
    vi.spyOn(adm, 'saveStats').mockResolvedValue();
    const items = [
      {name: 'Long Hair', originalTag: 'long_hair', count: 9},
      {name: 'Bald', originalTag: '~bald ~bald_female', count: 1},
      {name: 'Unknown', originalTag: 'short_hair', count: 0, unknown: true},
    ];
    await adm.enrichThumbnails(
      'hair_length_dist',
      42,
      items as never,
      makeSyncUser({name: 'tester'}),
    );
    return fetchThumb.mock.calls.map(c => c[0]);
  }

  it('anonymous (limit 2): sends none', async () => {
    expect(await thumbQueries('0')).toEqual([]);
  });

  it('Member (limit 3): sends the 3-term one, not the 4-term Bald', async () => {
    expect(await thumbQueries('20')).toEqual([
      'user:tester long_hair order:score rating:g',
    ]);
  });

  it('Gold (unlimited): sends both; never one for an unknown slice', async () => {
    expect(await thumbQueries('30')).toEqual([
      'user:tester long_hair order:score rating:g',
      'user:tester ~bald ~bald_female order:score rating:g',
    ]);
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

describe('getRecentUploadWindow — live window for the At a glance pane', () => {
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

  const row = {
    id: 9,
    created_at: '2026-10-17T06:30:00.000-04:00',
    score: 4,
    tag_count_general: 2,
    rating: 'q',
    is_pending: true,
    is_flagged: false,
    is_deleted: false,
    is_banned: false,
    tag_string_copyright: 'blue_archive original',
    tag_string_character: '',
  };

  function setup(body: unknown, ok = true) {
    const rl = makeSyncRateLimiter(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }));
    const db = makeSyncDb(makePostsTable());
    const adm = new AnalyticsDataManager(db as never, rl as never);
    return {rl, db, adm};
  }

  it('requests the newest 200 uploads without a status metatag', async () => {
    const {rl, adm} = setup([row]);
    await adm.getRecentUploadWindow(makeSyncUser({id: '42', name: 'a b'}));
    const url = rl.fetch.mock.calls[0][0] as string;
    expect(url).toContain(`tags=${encodeURIComponent('user:a_b')}&`);
    expect(url).toContain('limit=200');
    expect(url).toContain('tag_string_copyright,tag_string_character');
    expect(url).not.toContain('status');
  });

  it('maps rows to window points and caches them', async () => {
    const {db, adm} = setup([row]);
    const points = await adm.getRecentUploadWindow(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    expect(points).toEqual([
      {
        id: 9,
        ts: Date.parse('2026-10-17T10:30:00Z'),
        del: false,
        ban: false,
        pending: true,
        flagged: false,
        score: 4,
        gentags: 2,
        rating: 'q',
        copyrights: ['blue_archive', 'original'],
        characters: [],
      },
    ]);
    expect(db.piestats.put).toHaveBeenCalledWith(
      expect.objectContaining({key: 'recent_window', data: points}),
    );
  });

  it('serves a fresh cache without a request', async () => {
    const {rl, db, adm} = setup([row]);
    db.piestats.get.mockResolvedValue({
      data: [{id: 1}],
      updated_at: new Date().toISOString(),
    } as never);
    const points = await adm.getRecentUploadWindow(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    expect(points).toEqual([{id: 1}]);
    expect(rl.fetch).not.toHaveBeenCalled();
  });

  it('returns [] and caches nothing on failure', async () => {
    const {db, adm} = setup({error: 'x'}, false);
    const points = await adm.getRecentUploadWindow(
      makeSyncUser({id: '42', name: 'tester'}),
    );
    expect(points).toEqual([]);
    expect(db.piestats.put).not.toHaveBeenCalled();
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

  // Three milestone posts with a thumbnail URL (→ the getMilestones
  // missing-thumbnail path never fires an API call). Their `no`
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

  describe('thumbnail lookup (T-506)', () => {
    /** A milestone row as the sync stores it: a preview URL, no variants. */
    const syncedRow = (no: number, extra: Record<string, unknown> = {}) => ({
      id: 1000 + no,
      uploader_id: 42,
      no,
      rating: 'g',
      score: 5,
      created_at: '2025-01-01T00:00:00Z',
      preview_file_url: `http://x/${no}.jpg`,
      ...extra,
    });

    /** Milestone rows for total=200 (targets 1, 100, 200) and a posts.update spy. */
    function makeDbWith(rows: Record<string, unknown>[]) {
      const postsTable = makePostsTable(rows);
      (postsTable._chain.count as ReturnType<typeof vi.fn>).mockResolvedValue(
        200,
      );
      const update = vi.fn(async () => 1);
      const db = makeSyncDb(Object.assign(postsTable, {update}));
      return {db, update};
    }

    it('sends nothing for rows that have a preview URL but no variants', async () => {
      // The sync never gets `variants`; the old "no variants" test sent a
      // lookup on every recompute (each sync, each dashboard open).
      const {db} = makeDbWith([syncedRow(1), syncedRow(100), syncedRow(200)]);
      const rl = makeSyncRateLimiter();
      const adm = new AnalyticsDataManager(db as never, rl as never);

      await adm.getMilestones(makeSyncUser(), false, 'auto');
      await adm.getMilestones(makeSyncUser(), true, 'auto');

      expect(rl.fetch).not.toHaveBeenCalled();
    });

    it('looks up only a row without any thumbnail URL and stores the answer', async () => {
      const {db, update} = makeDbWith([
        syncedRow(1),
        syncedRow(100, {preview_file_url: undefined}),
        syncedRow(200),
      ]);
      const rl = makeSyncRateLimiter(async () => ({
        ok: true,
        status: 200,
        json: async () => [
          {id: 1100, rating: 'g', preview_file_url: 'http://x/100-new.jpg'},
        ],
      }));
      const adm = new AnalyticsDataManager(db as never, rl as never);

      const result = await adm.getMilestones(makeSyncUser(), false, 'auto');

      expect(rl.fetch).toHaveBeenCalledTimes(1);
      const url = rl.fetch.mock.calls[0][0];
      expect(url).toContain('tags=id:1100&');
      expect(update).toHaveBeenCalledWith(
        1100,
        expect.objectContaining({preview_file_url: 'http://x/100-new.jpg'}),
      );
      const m100 = result.find(m => m.milestone === 100);
      expect(m100?.post.preview_file_url).toBe('http://x/100-new.jpg');
    });

    it('leaves an explicit row without a URL alone unless NSFW is on', async () => {
      const rows = [
        syncedRow(1),
        syncedRow(100, {rating: 'e', preview_file_url: undefined}),
        syncedRow(200),
      ];
      const rl = makeSyncRateLimiter();

      const sfw = makeDbWith(rows);
      await new AnalyticsDataManager(
        sfw.db as never,
        rl as never,
      ).getMilestones(makeSyncUser(), false, 'auto');
      expect(rl.fetch).not.toHaveBeenCalled();

      const nsfw = makeDbWith(rows);
      await new AnalyticsDataManager(
        nsfw.db as never,
        rl as never,
      ).getMilestones(makeSyncUser(), true, 'auto');
      expect(rl.fetch).toHaveBeenCalledTimes(1);
      expect(rl.fetch.mock.calls[0][0]).toContain('tags=id:1100&');
    });
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

// ============================================================
// AnalyticsDataManager.quickSyncAllPosts (<=1200-post path)
// ============================================================
//
// The worker-pool sync has broad coverage above; this path had none, even
// though it owns an invariant the *other* path depends on: it wipes the
// user's rows before re-fetching, which is precisely why pruneGhostPosts
// exempts it (a Quick-Synced user can never accumulate ghosts). An
// untested invariant that another module reasons about is the dangerous
// kind, so it is pinned here.

describe('AnalyticsDataManager.quickSyncAllPosts', () => {
  /** Danbooru's cursor page size for this path. */
  const PAGE_LIMIT = 200;

  beforeEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    AnalyticsDataManager.onProgressCallback = null;
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.mocked(quotaManager.bulkPutSafe).mockClear();
    vi.mocked(quotaManager.requestPersistence).mockClear();
  });

  afterEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** A post row as the API returns it, ascending ids from `startId`. */
  function makeApiPosts(count: number, startId = 1000) {
    return Array.from({length: count}, (_, i) => ({
      id: startId + i,
      uploader_id: 42,
      created_at: '2025-01-01T00:00:00Z',
      up_score: 5,
      down_score: -1,
      rating: 's',
      tag_count_general: 10,
    }));
  }

  type ApiPost = ReturnType<typeof makeApiPosts>[number];

  /**
   * Rate limiter that answers the count query with `total` and then serves
   * `pages` in cursor order. Records every /posts.json cursor it was asked
   * for so the pagination walk can be asserted.
   */
  function makeQuickLimiter(total: number, pages: ApiPost[][]) {
    const cursors: string[] = [];
    let pageIndex = 0;
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: total}}),
        };
      }
      cursors.push(new URLSearchParams(url.split('?')[1]).get('page') ?? '');
      const batch = pages[pageIndex++] ?? [];
      return {ok: true, status: 200, json: async () => batch};
    });
    return {rl, cursors};
  }

  /** Silence the post-sync work that has its own coverage. */
  function quietTail(adm: AnalyticsDataManager) {
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();
  }

  it('wipes the user rows before re-fetching — the reason ghosts cannot accrue', async () => {
    // pruneGhostPosts (syncAllPosts) skips this path on the strength of this
    // delete. If it ever stopped happening, Quick Sync would start
    // accumulating remotely-deleted posts with nothing to reconcile them.
    const postsTable = makePostsTable([]);
    const {rl} = makeQuickLimiter(3, [makeApiPosts(3)]);
    const adm = new AnalyticsDataManager(
      makeSyncDb(postsTable) as never,
      rl as never,
    );
    quietTail(adm);

    await adm.quickSyncAllPosts(makeSyncUser({id: '42'}));

    expect(postsTable.where).toHaveBeenCalledWith('uploader_id');
    expect(postsTable._chain.equals).toHaveBeenCalledWith(42);
    expect(postsTable._chain.delete).toHaveBeenCalled();

    // Ordering matters as much as the call: a delete that landed *after* the
    // fetch would throw the freshly written rows away.
    // `/counts/posts.json?` contains `/posts.json?` as a substring, so the
    // count query has to be excluded explicitly — it legitimately precedes
    // the wipe and would make this assertion pass for the wrong reason.
    const firstPostsFetch = rl.fetch.mock.calls.findIndex(
      (c: unknown[]) =>
        String(c[0]).includes('/posts.json?') &&
        !String(c[0]).includes('/counts/'),
    );
    expect(firstPostsFetch).toBeGreaterThanOrEqual(0);
    const deleteMock = postsTable._chain.delete as ReturnType<typeof vi.fn>;
    expect(deleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      rl.fetch.mock.invocationCallOrder[firstPostsFetch],
    );
  });

  it('walks the cursor from a0 and stops on a short page', async () => {
    const full = makeApiPosts(PAGE_LIMIT, 1000);
    const tail = makeApiPosts(5, 2000);
    const {rl, cursors} = makeQuickLimiter(PAGE_LIMIT + 5, [full, tail]);
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      rl as never,
    );
    quietTail(adm);

    await adm.quickSyncAllPosts(makeSyncUser({id: '42'}));

    // Second cursor is keyed to the last id of the first page; a short page
    // ends the walk without an extra empty round-trip.
    expect(cursors).toEqual(['a0', `a${1000 + PAGE_LIMIT - 1}`]);
  });

  it('numbers posts sequentially across pages, oldest first', async () => {
    const full = makeApiPosts(PAGE_LIMIT, 1000);
    const tail = makeApiPosts(3, 5000);
    const {rl} = makeQuickLimiter(PAGE_LIMIT + 3, [full, tail]);
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      rl as never,
    );
    quietTail(adm);

    await adm.quickSyncAllPosts(makeSyncUser({id: '42'}));

    const written = vi
      .mocked(quotaManager.bulkPutSafe)
      .mock.calls.flatMap(c => c[1] as Array<{id: number; no: number}>);
    expect(written).toHaveLength(PAGE_LIMIT + 3);
    // `no` is the user's own upload ordinal — it must run 1..N unbroken
    // across the page boundary, since milestones look up [uploader_id+no].
    expect(written.map(r => r.no)).toEqual(
      Array.from({length: PAGE_LIMIT + 3}, (_, i) => i + 1),
    );
    expect(written[0].id).toBe(1000);
    expect(written[written.length - 1].id).toBe(5002);
  });

  it('reverses a descending batch so no follows upload order', async () => {
    // Danbooru can answer newest-first; numbering that as-is would make post
    // #1 the newest upload and invert every milestone.
    const descending = makeApiPosts(3, 1000).reverse();
    const {rl} = makeQuickLimiter(3, [descending]);
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      rl as never,
    );
    quietTail(adm);

    await adm.quickSyncAllPosts(makeSyncUser({id: '42'}));

    const written = vi.mocked(quotaManager.bulkPutSafe).mock
      .calls[0][1] as Array<{id: number; no: number}>;
    expect(written.map(r => [r.id, r.no])).toEqual([
      [1000, 1],
      [1001, 2],
      [1002, 3],
    ]);
  });

  it('stamps completion only after the walk finishes', async () => {
    const {rl} = makeQuickLimiter(2, [makeApiPosts(2)]);
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      rl as never,
    );
    quietTail(adm);

    await adm.quickSyncAllPosts(makeSyncUser({id: '42'}));

    const ls = vi.mocked(localStorage.setItem);
    const keys = ls.mock.calls.map((c: string[]) => c[0]);
    expect(keys).toContain('danbooru_grass_last_sync_42');
    // quickSync writes every field straight from the API; that completion is
    // recorded in sync_meta (T-402 tests), not the old flag (T-403).
    expect(keys).not.toContain('di_post_metadata_v2_42');
    expect(quotaManager.requestPersistence).toHaveBeenCalled();
  });

  it('does not touch the DB when the user is unidentifiable', async () => {
    const postsTable = makePostsTable([]);
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(
      makeSyncDb(postsTable) as never,
      rl as never,
    );

    await adm.quickSyncAllPosts(makeSyncUser({id: undefined}));
    await adm.quickSyncAllPosts(makeSyncUser({name: ''}));

    expect(postsTable._chain.delete).not.toHaveBeenCalled();
    expect(rl.fetch).not.toHaveBeenCalled();
  });

  it('a lock-blocked run deletes nothing', async () => {
    // The early return sits above the wipe. If it ever moved below it, a
    // second tab's click would clear the rows the running sync is writing.
    AnalyticsDataManager.isGlobalSyncing = true;
    const postsTable = makePostsTable([]);
    const rl = makeSyncRateLimiter();
    const adm = new AnalyticsDataManager(
      makeSyncDb(postsTable) as never,
      rl as never,
    );

    await adm.quickSyncAllPosts(makeSyncUser({id: '42'}));

    expect(postsTable._chain.delete).not.toHaveBeenCalled();
    expect(rl.fetch).not.toHaveBeenCalled();
    // The lock belongs to the run that took it — this one must not clear it.
    expect(AnalyticsDataManager.isGlobalSyncing).toBe(true);
  });

  it('releases the lock when a page fetch throws', async () => {
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 5}}),
        };
      }
      throw new Error('network down');
    });
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([])) as never,
      rl as never,
    );
    quietTail(adm);

    await expect(
      adm.quickSyncAllPosts(makeSyncUser({id: '42'})),
    ).rejects.toThrow('network down');

    // Otherwise every later sync in this tab is refused by a lock nobody holds.
    expect(AnalyticsDataManager.isGlobalSyncing).toBe(false);
    expect(AnalyticsDataManager.onProgressCallback).toBeNull();
  });
});

// A 429 during the post-sync burst used to be saved as data: the rating pie
// showed Explicit 0 and Recent Popular "No posts found" for the whole cache
// TTL. Failed runs must not write the cache.
describe('failed fetches are not cached', () => {
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

  function makeAdm(fetchImpl?: Parameters<typeof makeSyncRateLimiter>[0]) {
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable()) as never,
      makeSyncRateLimiter(fetchImpl) as never,
    );
    const save = vi.spyOn(adm, 'saveStats').mockResolvedValue();
    const getStats = vi.spyOn(adm, 'getStats');
    return {adm, save, getStats};
  }
  const user = makeSyncUser({id: '42', name: 'tester'});

  it('rating: one failed count keeps the previous cache', async () => {
    const {adm, save, getStats} = makeAdm();
    const previous = [{rating: 'e', count: 900, label: 'Explicit'}];
    getStats.mockResolvedValue(previous);
    vi.spyOn(adm, 'fetchRemoteCount').mockImplementation(async q => {
      if (q.includes('rating:e')) throw new Error('HTTP 429');
      return 10;
    });

    const result = await adm.getRatingDistribution(user, null, true);

    expect(save).not.toHaveBeenCalled();
    expect(result).toBe(previous);
  });

  it('rating: a clean run is cached as before', async () => {
    const {adm, save} = makeAdm();
    vi.spyOn(adm, 'fetchRemoteCount').mockResolvedValue(10);

    await adm.getRatingDistribution(user, null, true);

    expect(save).toHaveBeenCalledWith(
      'rating_dist',
      42,
      expect.arrayContaining([expect.objectContaining({count: 10})]),
    );
  });

  it('status: a failed count with no previous cache returns the partial result unsaved', async () => {
    const {adm, save, getStats} = makeAdm();
    getStats.mockResolvedValue(null);
    vi.spyOn(adm, 'fetchRemoteCount').mockImplementation(async q => {
      if (q.includes('status:deleted')) throw new Error('HTTP 429');
      return 5;
    });

    const result = await adm.getStatusDistribution(user, null, true);

    expect(save).not.toHaveBeenCalled();
    expect(result.find(r => r.name === 'active')?.count).toBe(5);
  });

  it('recent popular: a 429 is not cached, an empty week is', async () => {
    const post = {id: 7, score: 50};
    let nsfwStatus = 429;
    const {adm, save} = makeAdm(async (url: string) => {
      if (url.includes('is%3Ansfw')) {
        return nsfwStatus === 200
          ? {ok: true, status: 200, json: async () => []}
          : {
              ok: false,
              status: 429,
              json: async () => {
                throw new SyntaxError('Unexpected token <');
              },
            };
      }
      return {ok: true, status: 200, json: async () => [post]};
    });

    await adm.getRecentPopularPosts(user, true);
    expect(save).not.toHaveBeenCalled();

    nsfwStatus = 200; // no NSFW upload this week: a real "none"
    const result = await adm.getRecentPopularPosts(user, true);
    expect(result).toEqual({sfw: post, nsfw: null});
    expect(save).toHaveBeenCalledWith('recent_popular_posts', 42, result);
  });

  it('top posts: an HTML error body marks the run failed', async () => {
    const {adm, save, getStats} = makeAdm(async (url: string) =>
      url.includes('rating%3Ag')
        ? {
            ok: false,
            status: 503,
            json: async () => {
              throw new SyntaxError('Unexpected token <');
            },
          }
        : {ok: true, status: 200, json: async () => [{id: 1}]},
    );
    getStats.mockResolvedValue(null);

    const result = await adm.getTopPostsByType(user, true);

    expect(save).not.toHaveBeenCalled();
    expect(result.g).toBeNull();
    expect(result.s).toEqual({id: 1});
  });
});

describe('getActivityDistribution — suspicious uploads', () => {
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

  it('flags deleted / flagged / suspicious-tag / downvoted uploads, not banned', async () => {
    const posts = [
      {
        id: 1,
        is_deleted: true,
        is_flagged: false,
        score: 5,
        tag_string_meta: 'highres',
      },
      {
        id: 2,
        is_deleted: false,
        is_flagged: true,
        score: 5,
        tag_string_meta: 'highres',
      },
      {
        id: 3,
        is_deleted: false,
        is_flagged: false,
        score: 5,
        tag_string_meta: 'highres',
      },
      {
        id: 4,
        is_deleted: false,
        is_flagged: false,
        score: 5,
        tag_string_meta: 'ai-generated highres',
      },
      {
        id: 5,
        is_deleted: false,
        is_flagged: false,
        score: -3,
        tag_string_meta: 'highres',
      },
      // Banned (artist takedown) but otherwise healthy → stays an upload.
      {
        id: 6,
        is_deleted: false,
        is_banned: true,
        is_flagged: false,
        score: 5,
        tag_string_meta: 'highres',
      },
    ];
    const urls: string[] = [];
    const rl = makeSyncRateLimiter(async (url: string) => {
      urls.push(url);
      let rows: unknown = [];
      if (
        url.startsWith('/post_versions.json') &&
        url.includes('is_new]=true')
      ) {
        rows = posts.map((p, i) => ({
          id: 100 + p.id,
          post_id: p.id,
          created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        }));
      } else if (url.startsWith('/posts.json')) {
        rows = posts;
      }
      return {ok: true, status: 200, json: async () => rows};
    });
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable()) as never,
      rl as never,
    );

    const dist = await adm.getActivityDistribution(makeSyncUser(), 200);
    const typeOf = (postId: number) =>
      dist.recent.find(s => s.postId === postId || s.anchorId === postId)?.type;
    expect([1, 2, 3, 4, 5, 6].map(typeOf)).toEqual([
      'suspicious',
      'suspicious',
      'upload',
      'suspicious',
      'suspicious',
      'upload',
    ]);
    expect(dist.suspiciousPostIds.sort()).toEqual([1, 2, 4, 5]);

    // One batch lookup carries every signal — no second (OR-tag) request.
    const lookups = urls.filter(u => u.startsWith('/posts.json'));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toContain(
      'only=id,is_deleted,is_flagged,score,tag_string_meta',
    );
    expect(decodeURIComponent(lookups[0])).not.toContain('~');
  });
});

// T-403: existing users' rows are brought to fields version 2 by fetching
// every row again in id ranges, resumable, with the watermark of the first
// response.
describe('splitIdRanges', () => {
  it('cuts sorted ids into contiguous ranges of about the same size', () => {
    expect(splitIdRanges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toEqual([
      {after: 0, to: 4},
      {after: 4, to: 7},
      {after: 7, to: 10},
    ]);
  });

  it('makes no more ranges than ids, and none without ids', () => {
    expect(splitIdRanges([5, 9], 3)).toEqual([
      {after: 4, to: 5},
      {after: 5, to: 9},
    ]);
    expect(splitIdRanges([], 3)).toEqual([]);
  });
});

describe('fields backfill (T-403)', () => {
  const DATE = 'Sat, 14 Nov 2026 13:53:29 GMT';
  let storage: Map<string, string>;

  beforeEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.mocked(quotaManager.bulkPutSafe).mockClear();
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => storage.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => storage.set(k, v)),
      removeItem: vi.fn((k: string) => storage.delete(k)),
    });
    vi.stubGlobal('document', {
      body: {dataset: {currentUserTimeZone: 'Seoul'}},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Old rows: no tag fields, numbered 1..n. */
  const oldRows = (ids: number[]) =>
    ids.map((id, i) => ({
      id,
      uploader_id: 42,
      no: i + 1,
      created_at: '2020-01-01T00:00:00Z',
      score: 1,
      rating: 'g',
    }));

  /** The remote: these ids exist; `fail` answers a status for some ranges. */
  function serveRemote(
    ids: number[],
    fail: (from: number) => number | null = () => null,
  ) {
    const asked: string[] = [];
    const rl = makeSyncRateLimiter(async (url: string) => {
      const tags = new URLSearchParams(url.split('?')[1]).get('tags') ?? '';
      asked.push(tags);
      const [, a, b] = /id:(\d+)\.\.(\d+)/.exec(tags) ?? [];
      const status = fail(Number(a));
      if (status) return {ok: false, status, json: async () => ({})};
      const posts = ids
        .filter(id => id >= Number(a) && id <= Number(b))
        .map(id => ({
          id,
          uploader_id: 42,
          created_at: '2020-01-01T09:00:00+09:00',
          up_score: 2,
          down_score: 0,
          rating: 'g',
          tag_count: 12,
          tag_string_character: 'char_' + id,
          tag_string_copyright: 'touhou',
        }));
      return {
        ok: true,
        status: 200,
        json: async () => posts,
        headers: {get: (n: string) => (n === 'date' ? DATE : null)},
      };
    });
    return {rl, asked};
  }

  function setUp(
    rows: Record<string, unknown>[],
    rl: ReturnType<typeof makeSyncRateLimiter>,
    meta?: Record<string, unknown>,
  ) {
    const metaRows = new Map<number, Record<string, unknown>>();
    if (meta) metaRows.set(42, {userId: 42, ...meta});
    const syncMeta = {
      get: vi.fn(async (k: number) => metaRows.get(k)),
      put: vi.fn(async (r: Record<string, unknown>) => {
        metaRows.set(r.userId as number, structuredClone(r));
      }),
      delete: vi.fn(async (k: number) => {
        metaRows.delete(k);
      }),
    };
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable(rows), {sync_meta: syncMeta}) as never,
      rl as never,
    );
    const written = () =>
      vi
        .mocked(quotaManager.bulkPutSafe)
        .mock.calls.flatMap(c => c[1] as Record<string, unknown>[]);
    return {adm, metaRows, written};
  }

  const user = makeSyncUser({id: '42'});

  it('is needed for a user with rows and no fields version 2', async () => {
    const {rl} = serveRemote([]);
    expect(
      await setUp(oldRows([1]), rl).adm.needsPostMetadataBackfill(user),
    ).toBe(true);
    expect(
      await setUp(oldRows([1]), rl, {
        fieldsVersion: 2,
      }).adm.needsPostMetadataBackfill(user),
    ).toBe(false);
    expect(await setUp([], rl).adm.needsPostMetadataBackfill(user)).toBe(false);
  });

  it('is not needed while in failure cooldown', async () => {
    storage.set(
      backfillFailureStorageKey(42),
      JSON.stringify({
        lastAttemptAt: Date.now(),
        failureCount: BACKFILL_FAILURE_THRESHOLD,
      }),
    );
    const {rl} = serveRemote([]);
    expect(
      await setUp(oldRows([1]), rl).adm.needsPostMetadataBackfill(user),
    ).toBe(false);
  });

  it('rebuilds every row under its own number and records version 2 with the first response time', async () => {
    const {rl, asked} = serveRemote([10, 20, 25, 30]);
    const {adm, metaRows, written} = setUp(oldRows([10, 20, 30]), rl);
    const progress = vi.fn();

    await adm.backfillPostMetadata(user, progress);

    // Three ranges, each walked by id range in 2 search terms.
    expect(asked.sort()).toEqual([
      'user:test_user status:any id:10..10 order:id',
      'user:test_user status:any id:11..20 order:id',
      'user:test_user status:any id:21..30 order:id',
    ]);
    const rows = written().sort((a, b) => (a.id as number) - (b.id as number));
    // 25 is a post the rows lack: the sync's to add.
    expect(rows.map(r => [r.id, r.no, r.chr])).toEqual([
      [10, 1, 'char_10'],
      [20, 2, 'char_20'],
      [30, 3, 'char_30'],
    ]);
    expect(metaRows.get(42)).toMatchObject({
      fieldsVersion: 2,
      changeWatermark: Date.parse(DATE),
      timeZone: 'Seoul',
      backfill: undefined,
    });
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it('resumes a saved plan where it stopped, keeping its watermark', async () => {
    const {rl, asked} = serveRemote([10, 20, 30]);
    // The first range was done; the second had not started.
    const {adm, metaRows} = setUp(oldRows([10, 20, 30]), rl, {
      backfill: {
        from: 1234,
        ranges: [
          {after: 20, to: 20},
          {after: 20, to: 30},
        ],
      },
    });

    await adm.backfillPostMetadata(user);

    expect(asked).toEqual(['user:test_user status:any id:21..30 order:id']);
    expect(metaRows.get(42)).toMatchObject({
      fieldsVersion: 2,
      changeWatermark: 1234,
    });
  });

  it('stops on an HTTP error, records the failure and keeps the progress', async () => {
    const {rl} = serveRemote([10, 20, 30], from => (from === 21 ? 500 : null));
    const {adm, metaRows} = setUp(oldRows([10, 20, 30]), rl);

    await adm.backfillPostMetadata(user);

    const meta = metaRows.get(42)!;
    expect(meta.fieldsVersion).toBeUndefined();
    const plan = meta.backfill as {
      from: number;
      ranges: Array<{after: number; to: number}>;
    };
    expect(plan.from).toBe(Date.parse(DATE));
    // The failed range has not moved.
    expect(plan.ranges.find(r => r.to === 30)?.after).toBe(20);
    expect(storage.has(backfillFailureStorageKey(42))).toBe(true);
  });

  it('counts a run whose parallel ranges all fail as one failure', async () => {
    const {rl} = serveRemote([10, 20, 30], () => 500);
    const {adm} = setUp(oldRows([10, 20, 30]), rl);

    await adm.backfillPostMetadata(user);

    // The three ranges were in flight together and all failed.
    expect(rl.fetch).toHaveBeenCalledTimes(3);
    const state = JSON.parse(storage.get(backfillFailureStorageKey(42))!);
    expect(state.failureCount).toBe(1);
  });

  it('stops on a 429 without counting it as a failure', async () => {
    const {rl} = serveRemote([10, 20, 30], () => 429);
    const {adm, metaRows} = setUp(oldRows([10, 20, 30]), rl);

    await adm.backfillPostMetadata(user);

    expect(metaRows.get(42)?.fieldsVersion).toBeUndefined();
    expect(storage.has(backfillFailureStorageKey(42))).toBe(false);
  });

  it('clearUserData drops the sync state with the rows', async () => {
    const {rl} = serveRemote([]);
    const {adm, metaRows} = setUp(oldRows([1]), rl, {fieldsVersion: 2});

    await adm.clearUserData(user);

    expect(metaRows.has(42)).toBe(false);
    // And the counters, under the string id they are stored by (T-505).
    const userStats = (
      adm as unknown as {db: {user_stats: {delete: ReturnType<typeof vi.fn>}}}
    ).db.user_stats;
    expect(userStats.delete).toHaveBeenCalledWith('42');
  });
});

// T-404: rows with a numbering gap sync from the start, and a sync that
// started but did not complete keeps its rows through the cleanup.
describe('isStaleUser', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;
  const keep = 14 * DAY;

  it('deletes rows without a completed sync or a recent start', () => {
    expect(isStaleUser(null, undefined, now, keep)).toBe(true);
    expect(isStaleUser(null, now - 20 * DAY, now, keep)).toBe(true);
  });

  it('keeps the rows of a sync started within the period, completed or not', () => {
    expect(isStaleUser(null, now - DAY, now, keep)).toBe(false);
    expect(isStaleUser(now - 30 * DAY, now - DAY, now, keep)).toBe(false);
  });

  it('follows the completed sync otherwise', () => {
    expect(isStaleUser(now - DAY, undefined, now, keep)).toBe(false);
    expect(isStaleUser(now - 20 * DAY, undefined, now, keep)).toBe(true);
  });
});

describe('row numbering and the sync mark (T-404)', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => storage.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => storage.set(k, v)),
      removeItem: vi.fn((k: string) => storage.delete(k)),
    });
    vi.stubGlobal('setTimeout', (fn: () => void) => fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const row = (id: number, no: number, createdAt: string) => ({
    id,
    uploader_id: 42,
    no,
    created_at: createdAt,
  });

  function makeAdm(rows: Record<string, unknown>[]) {
    const asked: string[] = [];
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: rows.length}}),
        };
      }
      asked.push(decodeURIComponent(url));
      return {ok: true, status: 200, json: async () => []};
    });
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable(rows)) as never,
      rl as never,
    );
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();
    return {adm, asked};
  }

  it('finds a gap: fewer rows than the highest number', async () => {
    const intact = makeAdm([
      row(1, 1, '2024-01-01T00:00:00Z'),
      row(2, 2, '2025-03-01T00:00:00Z'),
    ]).adm;
    const holed = makeAdm([
      row(1, 1, '2024-01-01T00:00:00Z'),
      row(9, 5, '2025-03-01T00:00:00Z'),
    ]).adm;
    expect(await intact.rowNumberingIntact(42)).toBe(true);
    expect(await holed.rowNumberingIntact(42)).toBe(false);
    expect(await makeAdm([]).adm.rowNumberingIntact(42)).toBe(true);
  });

  it('syncs rows with a gap from the start instead of resuming', async () => {
    // Without the gap this would resume after post 100 (older than a
    // month before the newest).
    const {adm, asked} = makeAdm([
      row(900, 5, '2025-03-01T00:00:00Z'),
      row(100, 1, '2024-01-01T00:00:00Z'),
    ]);

    await adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());

    expect(asked[0]).toContain('id:>0');
  });

  it('a cleanup keeps a user whose first sync started recently but failed', async () => {
    const deleted: unknown[] = [];
    const meta = new Map<number, Record<string, unknown>>([
      [7, {userId: 7, syncStartedAt: Date.now() - 60_000}],
      [8, {userId: 8}],
    ]);
    const db = {
      posts: {
        orderBy: () => ({uniqueKeys: async () => [7, 8, 42]}),
        // Each user's rows: ids uid*100+1 and +2, read as index keys and
        // deleted in one bulk call (T-503).
        where: () => ({
          equals: (uid: number) => ({
            primaryKeys: async () => [uid * 100 + 1, uid * 100 + 2],
          }),
        }),
        bulkDelete: async (keys: number[]) => {
          deleted.push(...keys);
        },
      },
      piestats: {
        where: () => ({equals: () => ({delete: async () => 0})}),
      },
      sync_meta: {
        get: async (k: number) => meta.get(k),
        delete: vi.fn(async (k: number) => {
          meta.delete(k);
        }),
      },
      user_stats: {delete: vi.fn(async () => undefined)},
      tag_implications_cache: {
        where: vi.fn(() => ({below: () => ({delete: async () => 0})})),
      },
    };
    const adm = new AnalyticsDataManager(
      db as never,
      makeSyncRateLimiter() as never,
    );

    await adm.cleanupStaleData(42);

    // 7: started a minute ago, no completion stamp — kept.
    // 8: no stamp, no start — zombie rows, deleted. 42: the current user.
    expect(deleted).toEqual([801, 802]);
    // With its sync state (number key) and counters (string key) (T-505).
    expect(db.sync_meta.delete).toHaveBeenCalledTimes(1);
    expect(db.sync_meta.delete).toHaveBeenCalledWith(8);
    expect(db.user_stats.delete).toHaveBeenCalledTimes(1);
    expect(db.user_stats.delete).toHaveBeenCalledWith('8');
    expect(meta.has(7)).toBe(true);
    // Expired implication rows are pruned here too, not only on tag pages.
    expect(db.tag_implications_cache.where).toHaveBeenCalledWith('fetchedAt');
  });
});

// T-406: with every row at fields version 2, a completed sync and intact
// numbering, the status, rating, character and copyright pies and the user
// stats are counted from the local rows instead of /counts/posts.json.
describe('pies from the local rows (T-406)', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    resetTopLevelSessionCache();
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    storage = new Map([['danbooru_grass_last_sync_42', '2026-11-14']]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => storage.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => storage.set(k, v)),
      removeItem: vi.fn((k: string) => storage.delete(k)),
    });
    vi.stubGlobal('setTimeout', (fn: () => void) => fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  let nextId = 1;
  const v2 = (fields: Record<string, unknown>) => ({
    id: nextId,
    no: nextId++,
    uploader_id: 42,
    created_at: '2025-01-01T00:00:00Z',
    score: 1,
    rating: 'g',
    tag_count_general: 20,
    is_deleted: false,
    is_banned: false,
    pend: false,
    flag: false,
    tc: 30,
    chr: '',
    cpy: '',
    ...fields,
  });

  function setUp(
    meta: Record<string, unknown> | undefined,
    rows?: Record<string, unknown>[],
  ) {
    nextId = 1;
    const postRows = rows ?? [
      v2({rating: 'e', chr: 'reimu marisa', cpy: 'touhou'}),
      v2({is_deleted: true, chr: 'reimu', cpy: 'touhou'}),
      v2({pend: true, rating: 's', cpy: 'fate'}),
      v2({tag_count_general: 5, tc: 8}),
    ];
    const asked: string[] = [];
    const rl = makeSyncRateLimiter(async (url: string) => {
      asked.push(decodeURIComponent(url));
      if (url.startsWith('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: 3}}),
        };
      }
      // Implication lookups: nothing implies anything; thumbnails: none.
      return {ok: true, status: 200, json: async () => []};
    });
    const posts = makePostsTable(postRows);
    const db = makeSyncDb(posts, {
      sync_meta: {get: vi.fn(async () => meta)},
    });
    const adm = new AnalyticsDataManager(db as never, rl as never);
    const user = makeSyncUser({id: '42'});
    const counted = () => asked.filter(u => u.startsWith('/counts/'));
    return {adm, user, asked, counted, posts};
  }

  it('counts every status but appealed from the rows', async () => {
    const {adm, user, counted} = setUp({fieldsVersion: 2});

    const status = await adm.getStatusDistribution(user, null, true);

    expect(counted()).toEqual([
      '/counts/posts.json?tags=user:test_user status:appealed',
    ]);
    expect(Object.fromEntries(status.map(s => [s.name, s.count]))).toEqual({
      active: 2,
      appealed: 3,
      banned: 0,
      deleted: 1,
      flagged: 0,
      pending: 1,
    });
    expect(Object.keys(status[0]).sort()).toEqual(['count', 'label', 'name']);
  });

  it('counts the ratings with no request at all', async () => {
    const {adm, user, asked} = setUp({fieldsVersion: 2});

    const rating = await adm.getRatingDistribution(user, null, true);

    expect(asked).toEqual([]);
    expect(rating).toEqual([
      {rating: 'g', count: 2, label: 'General'},
      {rating: 's', count: 1, label: 'Sensitive'},
      {rating: 'q', count: 0, label: 'Questionable'},
      {rating: 'e', count: 1, label: 'Explicit'},
    ]);
  });

  it('builds the character pie from the rows: no related tags, no counts', async () => {
    const {adm, user, asked, counted} = setUp({fieldsVersion: 2});

    const chars = await adm.getCharacterDistribution(user, true);

    expect(asked.some(u => u.startsWith('/related_tag.json'))).toBe(false);
    expect(counted()).toEqual([]);
    expect(chars.map(c => [c.tagName, c.count, c.isOther])).toEqual([
      ['reimu', 2, false],
      ['marisa', 1, false],
      // 4 posts − 3 tagged.
      ['', 1, true],
    ]);
  });

  it('builds the copyright pie the same way', async () => {
    const {adm, user, counted} = setUp({fieldsVersion: 2});

    const copy = await adm.getCopyrightDistribution(user, true);

    expect(counted()).toEqual([]);
    expect(copy.slice(0, 2).map(c => [c.tagName, c.count])).toEqual([
      ['touhou', 2],
      ['fate', 1],
    ]);
  });

  it('gives the user stats from the rows', async () => {
    const {adm, user, counted} = setUp({fieldsVersion: 2});

    expect(await adm.getUserStats(user)).toEqual({
      gentags_lt_10: 1,
      tagcount_lt_10: 1,
    });
    expect(counted()).toEqual([]);
  });

  it('scans the rows once for one load', async () => {
    const {adm, user, posts} = setUp({fieldsVersion: 2});

    await adm.getStatusDistribution(user, null, true);
    await adm.getRatingDistribution(user, null, true);
    await adm.getUserStats(user);

    expect(posts._chain.each).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rows below fields version 2', undefined],
    ['a sync under way or failed', {fieldsVersion: 2, syncStartedAt: 1}],
  ])('keeps counting remotely with %s', async (_label, meta) => {
    const {adm, user, counted} = setUp(meta);

    await adm.getRatingDistribution(user, null, true);

    expect(counted()).toHaveLength(4);
  });

  it('keeps counting remotely without a completed sync', async () => {
    const {adm, user, counted} = setUp({fieldsVersion: 2});
    storage.clear();

    await adm.getRatingDistribution(user, null, true);

    expect(counted()).toHaveLength(4);
  });

  it('keeps counting remotely when the numbering has a gap', async () => {
    const {adm, user, counted} = setUp({fieldsVersion: 2}, [
      {...v2({}), no: 1},
      {...v2({}), no: 5},
    ]);

    await adm.getRatingDistribution(user, null, true);

    expect(counted()).toHaveLength(4);
  });
});

// T-407: the local rows catch up with posts changed on Danbooru.
describe('catchUpWatermark', () => {
  const ttl = 600_000;
  const now = 10_000_000;
  const meta = (fields: Record<string, unknown>) =>
    ({userId: 42, fieldsVersion: 2, changeWatermark: 5000, ...fields}) as never;

  it('starts from the watermark of rows at fields version 2', () => {
    expect(catchUpWatermark(meta({}), now, ttl)).toBe(5000);
  });

  it.each([
    ['no row', undefined],
    ['no watermark', meta({changeWatermark: undefined})],
    ['rows below version 2', meta({fieldsVersion: 1})],
    ['a sync under way or failed', meta({syncStartedAt: 1})],
    ['an earlier overflow', meta({needsFullSync: true})],
    ['a catch-up within the TTL', meta({caughtUpAt: now - 1000})],
  ])('does not run with %s', (_label, m) => {
    expect(catchUpWatermark(m, now, ttl)).toBeNull();
  });

  it('runs again once the TTL has passed', () => {
    expect(catchUpWatermark(meta({caughtUpAt: now - ttl - 1}), now, ttl)).toBe(
      5000,
    );
  });
});

describe('catchUpChanges (T-407)', () => {
  const W = Date.parse('2026-11-10T00:00:00Z');
  let storage: Map<string, string>;

  beforeEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.mocked(quotaManager.bulkPutSafe).mockClear();
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => storage.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => storage.set(k, v)),
      removeItem: vi.fn((k: string) => storage.delete(k)),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const post = (id: number, updatedAt: string, uploaderId = 42) => ({
    id,
    uploader_id: uploaderId,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: updatedAt,
    rating: 'q',
    tag_string_character: 'changed',
  });

  /** `pages[n - 1]` answers page n of `order:change`. */
  function setUp(
    meta: Record<string, unknown>,
    pages: Array<ReturnType<typeof post>[] | number>,
    localIds: number[],
  ) {
    const asked: string[] = [];
    const rl = makeSyncRateLimiter(async (url: string) => {
      asked.push(decodeURIComponent(url));
      const page = Number(new URLSearchParams(url.split('?')[1]).get('page'));
      const body = pages[page - 1] ?? [];
      if (typeof body === 'number') {
        return {ok: false, status: body, json: async () => ({})};
      }
      return {ok: true, status: 200, json: async () => body};
    });
    const rows = new Map<number, Record<string, unknown>>(
      localIds.map((id, i) => [
        id,
        {id, uploader_id: 42, no: i + 1, rating: 's', chr: 'old'},
      ]),
    );
    const posts = makePostsTable([...rows.values()]);
    Object.assign(posts, {
      bulkGet: vi.fn(async (ids: number[]) => ids.map(id => rows.get(id))),
    });
    const metaRows = new Map<number, Record<string, unknown>>([
      [42, {userId: 42, ...meta}],
    ]);
    const syncMeta = {
      get: vi.fn(async (k: number) => metaRows.get(k)),
      put: vi.fn(async (r: Record<string, unknown>) => {
        metaRows.set(r.userId as number, structuredClone(r));
      }),
    };
    const adm = new AnalyticsDataManager(
      makeSyncDb(posts, {sync_meta: syncMeta}) as never,
      rl as never,
    );
    const written = () =>
      vi
        .mocked(quotaManager.bulkPutSafe)
        .mock.calls.flatMap(c => c[1] as Record<string, unknown>[]);
    return {adm, asked, metaRows, written};
  }

  const user = makeSyncUser({id: '42'});
  const v2 = {fieldsVersion: 2, changeWatermark: W};

  it('overwrites the rows it has under their own number, and moves the watermark', async () => {
    const page1 = [
      post(7, '2026-11-12T00:00:00Z'),
      post(99, '2026-11-11T00:00:00Z'), // not in the rows: the sync's
      post(3, '2026-11-09T00:00:00Z'), // older than W: the walk ends
    ];
    const {adm, asked, metaRows, written} = setUp(v2, [page1], [3, 7]);

    const {changed} = await adm.catchUpChanges(user);

    expect(asked).toHaveLength(1);
    expect(new URLSearchParams(asked[0].split('?')[1]).get('tags')).toBe(
      'user:test_user order:change',
    );
    expect(changed).toBe(2);
    expect(written().map(r => [r.id, r.no, r.chr])).toEqual([
      [7, 2, 'changed'],
      [3, 1, 'changed'],
    ]);
    expect(metaRows.get(42)).toMatchObject({
      changeWatermark: Date.parse('2026-11-12T00:00:00Z'),
      caughtUpAt: expect.any(Number),
      catchUp: undefined,
    });
  });

  it('walks on while every row is newer, saving its progress', async () => {
    const full = (start: number) =>
      Array.from({length: 200}, (_, i) =>
        post(start + i, '2026-11-13T00:00:00Z'),
      );
    const {adm, asked, metaRows} = setUp(v2, [full(1000), full(2000), 503], []);

    await adm.catchUpChanges(user);

    // Page 3 failed: the walk stops, the watermark stays, page 3 is saved.
    expect(asked).toHaveLength(3);
    expect(metaRows.get(42)).toMatchObject({
      changeWatermark: W,
      catchUp: {page: 3, headAt: Date.parse('2026-11-13T00:00:00Z')},
    });
  });

  it('resumes a saved walk: the new changes first, then back where it stopped', async () => {
    const headAt = Date.parse('2026-11-13T00:00:00Z');
    const newer = post(1, '2026-11-14T00:00:00Z');
    const older = post(2, '2026-11-01T00:00:00Z');
    const fullOld = Array.from({length: 200}, (_, i) =>
      post(3000 + i, '2026-11-12T00:00:00Z'),
    );
    const {adm, asked} = setUp(
      {...v2, catchUp: {page: 4, headAt}},
      [[newer, ...fullOld.slice(0, 199)], fullOld, fullOld, [older]],
      [],
    );

    await adm.catchUpChanges(user);

    const pages = asked.map(u =>
      Number(new URLSearchParams(u.split('?')[1]).get('page')),
    );
    // Page 1 reaches below the saved head; the tail goes back to page 3.
    expect(pages).toEqual([1, 3, 4]);
  });

  it('sends nothing within the count TTL', async () => {
    const {adm, asked} = setUp({...v2, caughtUpAt: Date.now()}, [[]], []);
    expect(await adm.catchUpChanges(user)).toEqual({changed: 0});
    expect(asked).toEqual([]);
  });

  it('a user marked for a full sync syncs from the start', async () => {
    const {adm, asked} = setUp({...v2, needsFullSync: true}, [[]], [1, 2]);
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    vi.spyOn(adm, 'cleanupStaleData').mockResolvedValue();
    vi.stubGlobal('setTimeout', (fn: () => void) => fn());

    await adm.syncAllPosts(user, vi.fn());

    expect(asked.find(u => u.startsWith('/posts.json'))).toContain('id:>0');
  });
});

describe('one row scan per dashboard open (T-501)', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    storage = new Map([['danbooru_grass_last_sync_42', '2026-11-14']]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) => storage.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => storage.set(k, v)),
      removeItem: vi.fn((k: string) => storage.delete(k)),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** `YYYY-MM-DD` of `days` days ago (UTC). */
  const dayAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const recent1 = dayAgo(3);
  const recent2 = dayAgo(2);

  /** Rows as the sync stores them, numbered 1..n in id order. */
  const rows = [
    ['2020-03-01T10:00:00.000+09:00', 'g', 5, 12, 0, false, false],
    ['2020-03-02T23:59:00.000+09:00', 's', 3, 8, -1, true, false],
    ['2020-03-03T00:10:00.000+09:00', 'q', 0, 20, 0, false, false],
    ['2020-03-03T12:00:00.000+09:00', 'e', 10, 9, 0, false, true],
    ['2020-05-10T08:00:00.000+09:00', 'g', 2, 15, 0, false, false],
    [`${recent1}T12:00:00.000+09:00`, 'g', 1, 30, 0, false, false],
    [`${recent1}T13:00:00.000+09:00`, 's', 4, 31, -2, false, false],
    [`${recent2}T12:00:00.000+09:00`, 'g', 7, 32, 0, false, false],
  ].map(([created_at, rating, score, tgc, dn, del, ban], i) => ({
    id: i + 1,
    no: i + 1,
    uploader_id: 42,
    created_at,
    rating,
    score,
    tag_count_general: tgc,
    down_score: dn,
    is_deleted: del,
    is_banned: ban,
    pend: false,
    flag: false,
    tc: (tgc as number) + 5,
    chr: i % 2 ? 'reimu' : 'marisa reimu',
    cpy: 'touhou',
  }));

  function setUp() {
    const posts = makePostsTable(rows);
    const db = makeSyncDb(posts, {
      sync_meta: {get: vi.fn(async () => ({userId: 42, fieldsVersion: 2}))},
    });
    const adm = new AnalyticsDataManager(
      db as never,
      makeSyncRateLimiter() as never,
    );
    return {adm, posts, user: makeSyncUser({id: '42'})};
  }

  it('keeps the summary stats', async () => {
    const {adm, user} = setUp();

    const s = await adm.getSummaryStats(user);

    expect(s).toEqual({
      maxUploads: 2,
      maxDate: '2020-03-03',
      firstUploadDate: new Date('2020-03-01T10:00:00.000+09:00'),
      lastUploadDate: new Date(`${recent2}T12:00:00.000+09:00`),
      count1Year: 3,
      maxUploads1Year: 2,
      maxDate1Year: recent1,
      maxStreak: 3,
      maxStreakStart: '2020-03-01',
      maxStreakEnd: '2020-03-03',
      activeDays: 6,
    });
  });

  it('keeps the monthly stats, gaps filled', async () => {
    const {adm, user} = setUp();

    const m = await adm.getMonthlyStats(user, new Date(2020, 0, 15));

    expect(m.slice(0, 5)).toEqual([
      {date: '2020-01', count: 0, label: '2020-01'},
      {date: '2020-02', count: 0, label: '2020-02'},
      {date: '2020-03', count: 4, label: '2020-03'},
      {date: '2020-04', count: 0, label: '2020-04'},
      {date: '2020-05', count: 1, label: '2020-05'},
    ]);
    expect(m.reduce((n, e) => n + e.count, 0)).toBe(8);
    expect(m[m.length - 1].date).toBe(recent2.slice(0, 7));
  });

  it('keeps the scatter points', async () => {
    const {adm, user} = setUp();

    const points = await adm.getScatterData(user);

    expect(points).toHaveLength(8);
    expect(points[1]).toEqual({
      id: 2,
      d: Date.parse('2020-03-02T23:59:00.000+09:00'),
      s: 3,
      t: 8,
      r: 's',
      dn: -1,
      del: true,
      ban: false,
    });
    expect(points.map(p => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps the local distributions', async () => {
    const {adm} = setUp();

    const local = await adm.getLocalDistributions(42);

    expect(local).toMatchObject({
      rows: 8,
      rating: {g: 4, s: 2, q: 1, e: 1},
      status: {active: 7, deleted: 1, banned: 1, pending: 0, flagged: 0},
      gentagsUnder10: 2,
      tagcountUnder10: 0,
    });
    expect(local?.characters.get('reimu')).toBe(8);
    expect(local?.characters.get('marisa')).toBe(4);
    expect(local?.copyrights.get('touhou')).toBe(8);
  });

  it('reads the rows once for all four', async () => {
    const {adm, posts, user} = setUp();

    await adm.getSummaryStats(user);
    await Promise.all([
      adm.getScatterData(user),
      adm.getLocalDistributions(42),
      adm.getMonthlyStats(user),
    ]);
    await adm.getUserStats(user);

    expect(posts._chain.each).toHaveBeenCalledTimes(1);
  });

  it('reads them again once they changed', async () => {
    const {adm, posts, user} = setUp();

    await adm.getScatterData(user);
    (adm as unknown as {forgetLocalRows(id: number): void}).forgetLocalRows(42);
    await adm.getScatterData(user);

    expect(posts._chain.each).toHaveBeenCalledTimes(2);
  });

  it('hands out a copy of the points', async () => {
    const {adm, user} = setUp();

    const first = await adm.getScatterData(user);
    first.length = 0;

    expect(await adm.getScatterData(user)).toHaveLength(8);
  });
});

// T-504: the full sync's page pool ends on a short page, and stops claiming
// pages while an earlier one holds up the in-order commit.
describe('full sync page pool (T-504)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.mocked(quotaManager.bulkPutSafe).mockClear();
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('document', {
      body: {dataset: {currentUserTimeZone: 'Seoul'}},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Page n holds sizes[n - 1] posts (none past the end); page 1 can wait. */
  function servePages(sizes: number[], hold?: Promise<void>) {
    const asked: number[] = [];
    const total = sizes.reduce((a, b) => a + b, 0);
    const rl = makeSyncRateLimiter(async (url: string) => {
      if (url.includes('/counts/posts.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: total}}),
        };
      }
      const page = Number(new URLSearchParams(url.split('?')[1]).get('page'));
      asked.push(page);
      if (page === 1 && hold) await hold;
      const posts = Array.from({length: sizes[page - 1] ?? 0}, (_, i) => ({
        id: page * 1000 + i,
        uploader_id: 42,
        created_at: '2025-01-01T00:00:00Z',
        up_score: 1,
        down_score: 0,
        rating: 'g',
      }));
      return {ok: true, status: 200, json: async () => posts};
    });
    return {rl, asked};
  }

  function makeAdm(rl: ReturnType<typeof makeSyncRateLimiter>) {
    const syncMeta = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable([]), {sync_meta: syncMeta}) as never,
      rl as never,
    );
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    return adm;
  }

  const numbers = () =>
    vi
      .mocked(quotaManager.bulkPutSafe)
      .mock.calls.flatMap(c => (c[1] as Array<{no: number}>).map(r => r.no));

  it('ends on a page shorter than the page size', async () => {
    const {rl, asked} = servePages([200, 50]);
    const adm = makeAdm(rl);

    const run = adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await run;

    expect(outcome).toEqual({complete: true, started: true});
    // Page 2 held 50 posts: no page after it was asked for.
    expect(asked).toEqual([1, 2]);
    expect(numbers()).toEqual(Array.from({length: 250}, (_, i) => i + 1));
  });

  it('stops claiming pages while an earlier one holds up the commit', async () => {
    let release!: () => void;
    const hold = new Promise<void>(r => {
      release = r;
    });
    const {rl, asked} = servePages(Array(60).fill(200), hold);
    const adm = makeAdm(rl);

    const run = adm.syncAllPosts(makeSyncUser({id: '42'}), vi.fn());
    await vi.advanceTimersByTimeAsync(20_000);

    // Page 1 is stuck: the other workers fill the buffer to its cap (each
    // may have one more page in flight), then wait instead of claiming.
    const heldAt = Math.max(...asked);
    expect(heldAt).toBeGreaterThan(SYNC_BUFFER_MAX_PAGES);
    expect(heldAt).toBeLessThanOrEqual(SYNC_BUFFER_MAX_PAGES + SYNC_WORKERS);

    release();
    await vi.advanceTimersByTimeAsync(120_000);
    const outcome = await run;

    expect(outcome.complete).toBe(true);
    const nos = numbers();
    expect(nos).toHaveLength(60 * 200);
    expect(nos.every((n, i) => n === i + 1)).toBe(true);
  });
});

// T-508: a sync from the start searches from the user's first post, found
// by date and checked with a count, instead of `id:>0`.
describe('sync from the first post (T-508)', () => {
  const user = makeSyncUser({joinDate: new Date('2023-09-20T10:00:00Z')});

  beforeEach(() => {
    AnalyticsDataManager.isGlobalSyncing = false;
    vi.mocked(quotaManager.bulkPutSafe).mockClear();
    vi.stubGlobal('window', {location: {origin: 'https://danbooru.donmai.us'}});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('document', {
      body: {dataset: {currentUserTimeZone: 'Seoul'}},
    });
    vi.stubGlobal('setTimeout', (fn: () => void) => fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const post = {
    id: 6730462,
    uploader_id: 42,
    created_at: '2023-09-20T12:00:00Z',
    up_score: 1,
    down_score: 0,
    rating: 'g',
  };

  /** The lookup, the count below it, and pages (one post on the first). */
  function serve(
    opts: {lookup?: unknown; lookupStatus?: number; below?: number} = {},
  ) {
    const lookups: string[] = [];
    const pages: string[] = [];
    const counts: string[] = [];
    const rl = makeSyncRateLimiter(async (url: string) => {
      const tags = new URLSearchParams(url.split('?')[1]).get('tags') ?? '';
      if (url.startsWith('/counts/posts.json')) {
        counts.push(tags);
        const n = tags.includes('id:<') ? (opts.below ?? 0) : 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({counts: {posts: n}}),
        };
      }
      if (tags.includes('date:>=')) {
        lookups.push(tags);
        const status = opts.lookupStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () => opts.lookup ?? [{id: post.id}],
        };
      }
      pages.push(url);
      const first = pages.length === 1;
      return {ok: true, status: 200, json: async () => (first ? [post] : [])};
    });
    const pageParam = (i: number, key: string) =>
      new URLSearchParams(pages[i].split('?')[1]).get(key);
    return {rl, lookups, pages, counts, pageParam};
  }

  function makeAdm(
    rl: ReturnType<typeof makeSyncRateLimiter>,
    rows: Record<string, unknown>[] = [],
  ) {
    const syncMeta = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const adm = new AnalyticsDataManager(
      makeSyncDb(makePostsTable(rows), {sync_meta: syncMeta}) as never,
      rl as never,
    );
    vi.spyOn(adm, 'refreshCriticalStats').mockResolvedValue();
    return adm;
  }

  it('starts after the first post, found by date from the day before joining', async () => {
    const {rl, lookups, counts, pageParam} = serve();

    const outcome = await makeAdm(rl).syncAllPosts(user, vi.fn());

    expect(lookups).toEqual(['user:test_user order:id date:>=2023-09-19']);
    // Trusted only with none of the user's posts below it.
    expect(counts).toContain('user:test_user id:<6730462');
    expect(pageParam(0, 'tags')).toBe('user:test_user order:id id:>6730461');
    expect(outcome).toEqual({complete: true, started: true});
    const written = vi
      .mocked(quotaManager.bulkPutSafe)
      .mock.calls.flatMap(c => c[1] as Array<{id: number; no: number}>);
    expect(written.map(r => [r.id, r.no])).toEqual([[6730462, 1]]);
  });

  it('searches from id 0 when the user has posts below the one found', async () => {
    const {rl, pageParam} = serve({below: 3});

    await makeAdm(rl).syncAllPosts(user, vi.fn());

    expect(pageParam(0, 'tags')).toBe('user:test_user order:id id:>0');
  });

  it('searches from id 0 when the lookup fails or finds nothing', async () => {
    const failed = serve({lookupStatus: 500});
    await makeAdm(failed.rl).syncAllPosts(user, vi.fn());
    expect(failed.pageParam(0, 'tags')).toBe('user:test_user order:id id:>0');
    expect(failed.counts.some(t => t.includes('id:<'))).toBe(false);

    AnalyticsDataManager.isGlobalSyncing = false;
    const empty = serve({lookup: []});
    await makeAdm(empty.rl).syncAllPosts(user, vi.fn());
    expect(empty.pageParam(0, 'tags')).toBe('user:test_user order:id id:>0');
  });

  it('does not look when resuming', async () => {
    const {rl, lookups, pageParam} = serve();
    const rows = [
      {id: 900, uploader_id: 42, no: 2, created_at: '2025-03-01T00:00:00Z'},
      {id: 100, uploader_id: 42, no: 1, created_at: '2024-01-01T00:00:00Z'},
    ];

    await makeAdm(rl, rows).syncAllPosts(user, vi.fn());

    expect(lookups).toEqual([]);
    expect(pageParam(0, 'tags')).toBe('user:test_user order:id id:>100');
  });

  it('starts a quick sync after the first post too', async () => {
    const {rl, pageParam} = serve();

    await makeAdm(rl).quickSyncAllPosts(user);

    expect(pageParam(0, 'page')).toBe('a6730461');
  });
});
