/**
 * P1 — quota-manager unit tests.
 *
 * Covers `bulkPutSafe`, `unwrapAbortError`, and `evictOldestNonCurrentUser`.
 * `checkQuota` and `requestPersistence` are smoke-tested via stubbed
 * `navigator.storage`.
 */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import type {Table} from 'dexie';
import {
  bulkPutSafe,
  checkQuota,
  evictOldestNonCurrentUser,
  requestPersistence,
  unwrapAbortError,
} from '../src/core/quota-manager';
import type {Database} from '../src/core/database';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuotaError(): Error {
  const e = new Error('Quota');
  e.name = 'QuotaExceededError';
  return e;
}

function makeWrappedQuotaError(): Error {
  // Dexie wraps the real cause as `inner` on AbortError.
  const e = new Error('Aborted');
  e.name = 'AbortError';
  (e as Error & {inner: unknown}).inner = {name: 'QuotaExceededError'};
  return e;
}

interface MemoryStorage {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
}

function makeMemoryLocalStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

// ---------------------------------------------------------------------------
// unwrapAbortError
// ---------------------------------------------------------------------------

describe('unwrapAbortError', () => {
  it('extracts the error name from a plain Error', () => {
    expect(unwrapAbortError(new Error('boom'))).toEqual({name: 'Error'});
  });

  it('extracts inner.name when Dexie wraps the cause', () => {
    expect(unwrapAbortError(makeWrappedQuotaError())).toEqual({
      name: 'AbortError',
      innerName: 'QuotaExceededError',
    });
  });

  it('returns Unknown for non-object input', () => {
    expect(unwrapAbortError(null)).toEqual({name: 'Unknown'});
    expect(unwrapAbortError('string error')).toEqual({name: 'Unknown'});
    expect(unwrapAbortError(undefined)).toEqual({name: 'Unknown'});
  });
});

// ---------------------------------------------------------------------------
// bulkPutSafe
// ---------------------------------------------------------------------------

describe('bulkPutSafe', () => {
  beforeEach(() => {
    // Skip the sampling pre-check by default so the happy-path tests
    // don't need to stub navigator.storage.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeTable<T>(
    bulkPut: (records: T[]) => Promise<unknown>,
  ): Table<T, unknown> {
    return {bulkPut} as unknown as Table<T, unknown>;
  }

  it('happy path: bulkPut succeeds and evictor is not called', async () => {
    const bulkPut = vi.fn().mockResolvedValue(undefined);
    const evictor = vi.fn().mockResolvedValue(undefined);

    await bulkPutSafe(fakeTable(bulkPut), [{x: 1}], evictor);

    expect(bulkPut).toHaveBeenCalledOnce();
    expect(evictor).not.toHaveBeenCalled();
  });

  it('quota throw → evictor → retry succeeds', async () => {
    const bulkPut = vi
      .fn()
      .mockRejectedValueOnce(makeQuotaError())
      .mockResolvedValueOnce(undefined);
    const evictor = vi.fn().mockResolvedValue(undefined);

    await bulkPutSafe(fakeTable(bulkPut), [{x: 1}], evictor);

    expect(bulkPut).toHaveBeenCalledTimes(2);
    expect(evictor).toHaveBeenCalledOnce();
    // Eviction must happen between the two bulkPut calls.
    expect(evictor.mock.invocationCallOrder[0]).toBeGreaterThan(
      bulkPut.mock.invocationCallOrder[0],
    );
    expect(evictor.mock.invocationCallOrder[0]).toBeLessThan(
      bulkPut.mock.invocationCallOrder[1],
    );
  });

  it('AbortError-wrapped quota throw is also recognized', async () => {
    const bulkPut = vi
      .fn()
      .mockRejectedValueOnce(makeWrappedQuotaError())
      .mockResolvedValueOnce(undefined);
    const evictor = vi.fn().mockResolvedValue(undefined);

    await bulkPutSafe(fakeTable(bulkPut), [{x: 1}], evictor);

    expect(bulkPut).toHaveBeenCalledTimes(2);
    expect(evictor).toHaveBeenCalledOnce();
  });

  it('quota throw → evictor → retry fails → throw (no infinite loop)', async () => {
    const bulkPut = vi
      .fn()
      .mockRejectedValueOnce(makeQuotaError())
      .mockRejectedValueOnce(makeQuotaError());
    const evictor = vi.fn().mockResolvedValue(undefined);

    await expect(
      bulkPutSafe(fakeTable(bulkPut), [{x: 1}], evictor),
    ).rejects.toThrow();
    expect(bulkPut).toHaveBeenCalledTimes(2);
    expect(evictor).toHaveBeenCalledOnce();
  });

  it('non-quota error: evictor is not called and the error propagates', async () => {
    const bulkPut = vi.fn().mockRejectedValue(new Error('schema mismatch'));
    const evictor = vi.fn();

    await expect(
      bulkPutSafe(fakeTable(bulkPut), [{x: 1}], evictor),
    ).rejects.toThrow('schema mismatch');
    expect(evictor).not.toHaveBeenCalled();
  });

  it('pre-emptive eviction fires when sampled and quota is high', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always sample
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({usage: 95, quota: 100}),
      },
    });

    const bulkPut = vi.fn().mockResolvedValue(undefined);
    const evictor = vi.fn().mockResolvedValue(undefined);

    await bulkPutSafe(fakeTable(bulkPut), [{x: 1}], evictor);

    expect(evictor).toHaveBeenCalledOnce();
    expect(bulkPut).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('pre-emptive eviction does not fire when quota is healthy', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always sample
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({usage: 10, quota: 100}),
      },
    });

    const bulkPut = vi.fn().mockResolvedValue(undefined);
    const evictor = vi.fn().mockResolvedValue(undefined);

    await bulkPutSafe(fakeTable(bulkPut), [{x: 1}], evictor);

    expect(evictor).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// evictOldestNonCurrentUser
// ---------------------------------------------------------------------------

describe('evictOldestNonCurrentUser', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = makeMemoryLocalStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeFakeDb(uids: number[]) {
    const postsDelete = vi.fn().mockResolvedValue(undefined);
    const piestatsDelete = vi.fn().mockResolvedValue(undefined);
    const postsEqualsArg: number[] = [];
    const piestatsEqualsArg: number[] = [];

    const postsWhere = vi.fn().mockReturnValue({
      equals: (val: number) => {
        postsEqualsArg.push(val);
        return {delete: postsDelete};
      },
    });
    const piestatsWhere = vi.fn().mockReturnValue({
      equals: (val: number) => {
        piestatsEqualsArg.push(val);
        return {delete: piestatsDelete};
      },
    });

    const db = {
      posts: {
        orderBy: vi.fn().mockReturnValue({
          uniqueKeys: vi.fn().mockResolvedValue(uids),
        }),
        where: postsWhere,
      },
      piestats: {
        where: piestatsWhere,
      },
    } as unknown as Database;

    return {db, postsDelete, piestatsDelete, postsEqualsArg, piestatsEqualsArg};
  }

  it('never deletes data for the current user', async () => {
    storage.setItem(
      'danbooru_grass_last_sync_100',
      new Date('2025-01-01').toISOString(),
    );
    storage.setItem(
      'danbooru_grass_last_sync_200',
      new Date('2024-01-01').toISOString(),
    );

    const {db, postsEqualsArg, piestatsEqualsArg} = makeFakeDb([100, 200]);

    const evicted = await evictOldestNonCurrentUser(db, 100);

    expect(evicted).toBe(200); // older sync timestamp
    expect(postsEqualsArg).toEqual([200]);
    expect(piestatsEqualsArg).toEqual([200]);
    // The current user (100) must never appear in any delete chain.
    expect(postsEqualsArg).not.toContain(100);
    expect(piestatsEqualsArg).not.toContain(100);
  });

  it('returns null when only the current user is present', async () => {
    const {db, postsDelete, piestatsDelete} = makeFakeDb([100]);
    const evicted = await evictOldestNonCurrentUser(db, 100);
    expect(evicted).toBeNull();
    expect(postsDelete).not.toHaveBeenCalled();
    expect(piestatsDelete).not.toHaveBeenCalled();
  });

  it('handles users with missing sync timestamps as oldest', async () => {
    // uid 200 has no recorded sync, uid 300 has a recent one.
    storage.setItem(
      'danbooru_grass_last_sync_300',
      new Date('2025-01-01').toISOString(),
    );
    const {db} = makeFakeDb([100, 200, 300]);
    const evicted = await evictOldestNonCurrentUser(db, 100);
    expect(evicted).toBe(200);
  });

  it('removes the evicted user’s sync flag from localStorage', async () => {
    storage.setItem(
      'danbooru_grass_last_sync_200',
      new Date('2024-01-01').toISOString(),
    );
    const {db} = makeFakeDb([100, 200]);
    await evictOldestNonCurrentUser(db, 100);
    expect(storage.getItem('danbooru_grass_last_sync_200')).toBeNull();
  });

  it('accepts string currentUserId (parsed to number)', async () => {
    storage.setItem(
      'danbooru_grass_last_sync_200',
      new Date('2024-01-01').toISOString(),
    );
    const {db} = makeFakeDb([100, 200]);
    const evicted = await evictOldestNonCurrentUser(db, '100');
    expect(evicted).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// checkQuota / requestPersistence (smoke)
// ---------------------------------------------------------------------------

describe('checkQuota', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ratio = usage/quota when storage.estimate is available', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({usage: 30, quota: 100}),
      },
    });
    const snapshot = await checkQuota();
    expect(snapshot.available).toBe(true);
    expect(snapshot.usage).toBe(30);
    expect(snapshot.quota).toBe(100);
    expect(snapshot.ratio).toBeCloseTo(0.3, 5);
  });

  it('returns available=false when storage.estimate is missing', async () => {
    vi.stubGlobal('navigator', {});
    const snapshot = await checkQuota();
    expect(snapshot.available).toBe(false);
  });

  it('returns available=false when estimate throws', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });
    const snapshot = await checkQuota();
    expect(snapshot.available).toBe(false);
  });
});

describe('requestPersistence', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = makeMemoryLocalStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true and sets flag on first granted call', async () => {
    vi.stubGlobal('navigator', {
      storage: {persist: vi.fn().mockResolvedValue(true)},
    });
    const granted = await requestPersistence();
    expect(granted).toBe(true);
    expect(storage.getItem('di.persist.requested')).toBe('1');
  });

  it('short-circuits to true when already requested', async () => {
    storage.setItem('di.persist.requested', '1');
    const persistSpy = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('navigator', {storage: {persist: persistSpy}});

    const granted = await requestPersistence();

    expect(granted).toBe(true);
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('returns false when storage.persist is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const granted = await requestPersistence();
    expect(granted).toBe(false);
  });
});
