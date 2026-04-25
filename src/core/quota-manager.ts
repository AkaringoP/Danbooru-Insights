/**
 * Quota monitoring + QuotaExceededError recovery layer.
 *
 * Implements the P1 priority of `docs/v10/DanbooruInsights DB 전략 개선.md`:
 *   - `checkQuota()` reads `navigator.storage.estimate()` defensively
 *   - `bulkPutSafe()` wraps a Dexie `bulkPut` so QuotaExceededError is
 *     caught, an evictor runs, and the call is retried once
 *   - `requestPersistence()` asks the browser for persistent storage
 *   - `evictOldestNonCurrentUser()` is the default LRU evictor — it
 *     deletes the non-current user with the oldest sync timestamp,
 *     and *never* touches the current user
 *   - `unwrapAbortError()` extracts the inner cause that Dexie hides
 *     behind AbortError (where IndexedDB QuotaExceededError ends up)
 *
 * Constraint: `bulkPutSafe` opens its own retry path and therefore MUST
 * NOT be invoked inside an active `db.transaction(...)` callback —
 * the retry would race the outer transaction and trigger
 * `PrematureCommitError`. In-transaction call sites must keep the raw
 * `bulkPut` and rely on transactional atomicity instead.
 */
import type {Table} from 'dexie';
import type {Database} from './database';
import {createLogger} from './logger';

const log = createLogger('Quota');

/** localStorage key that records "we already asked the browser to persist". */
const PERSIST_FLAG = 'di.persist.requested';

/** localStorage key prefix used by analytics sync to record per-user
 *  sync timestamps. Mirrors `cleanupStaleData` in
 *  analytics-data-manager.ts so eviction can rank users by recency. */
const SYNC_KEY_PREFIX = 'danbooru_grass_last_sync_';

/** Pre-emptive eviction trigger: usage/quota above this fires evictor
 *  before the bulkPut, sampled per call to keep cost low. */
const QUOTA_PRESSURE_THRESHOLD = 0.8;

/** Probability of running a quota pre-check on a `bulkPutSafe` call.
 *  Keeps amortized cost ≈ 1 estimate() per ~4 bulk writes; the actual
 *  estimate() call is cheap (single-digit ms) but does involve IPC. */
const SAMPLING_RATE = 0.25;

export interface QuotaSnapshot {
  /** Bytes currently used by this origin (IndexedDB + caches + ...). */
  usage: number;
  /** Soft cap the browser will enforce (origin allowance). */
  quota: number;
  /** usage / quota in [0, 1]. 0 if quota is 0 or unavailable. */
  ratio: number;
  /** False if the browser does not expose `navigator.storage.estimate`. */
  available: boolean;
}

/** Read current storage usage. Always resolves; never throws. */
export async function checkQuota(): Promise<QuotaSnapshot> {
  if (
    typeof navigator === 'undefined' ||
    !('storage' in navigator) ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return {usage: 0, quota: 0, ratio: 0, available: false};
  }
  try {
    const est = await navigator.storage.estimate();
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    const ratio = quota > 0 ? usage / quota : 0;
    return {usage, quota, ratio, available: true};
  } catch {
    return {usage: 0, quota: 0, ratio: 0, available: false};
  }
}

/** Surface both the outer and inner names from a Dexie/IndexedDB
 *  exception. Dexie wraps QuotaExceededError as AbortError with the
 *  real cause in `.inner`, so the bare `e.name === 'QuotaExceededError'`
 *  check misses the common case. */
export function unwrapAbortError(e: unknown): {
  name: string;
  innerName?: string;
} {
  if (typeof e !== 'object' || e === null) {
    return {name: 'Unknown'};
  }
  const err = e as {name?: unknown; inner?: {name?: unknown}};
  const name = typeof err.name === 'string' ? err.name : 'Unknown';
  const innerName =
    err.inner && typeof err.inner.name === 'string'
      ? err.inner.name
      : undefined;
  return innerName ? {name, innerName} : {name};
}

function isQuotaExceeded(e: unknown): boolean {
  const {name, innerName} = unwrapAbortError(e);
  return name === 'QuotaExceededError' || innerName === 'QuotaExceededError';
}

/**
 * Wrap a `Table.bulkPut(records)` call with quota-aware retry.
 *
 * Behavior:
 *   1. With probability `SAMPLING_RATE`, run `checkQuota()`. If usage
 *      ratio is above `QUOTA_PRESSURE_THRESHOLD`, run `evictor()` once
 *      pre-emptively (failures here are logged and ignored).
 *   2. Attempt `table.bulkPut(records)`.
 *   3. On a non-quota error, log the unwrapped cause and rethrow.
 *   4. On a quota error, run `evictor()` and retry the bulkPut once.
 *   5. If the retry also fails, propagate the original error class.
 *
 * NOT safe inside `db.transaction(...)` callbacks — see module docstring.
 */
export async function bulkPutSafe<T, TKey>(
  table: Table<T, TKey>,
  records: readonly T[],
  evictor: () => Promise<unknown>,
): Promise<void> {
  if (Math.random() < SAMPLING_RATE) {
    const snapshot = await checkQuota();
    if (snapshot.available && snapshot.ratio > QUOTA_PRESSURE_THRESHOLD) {
      log.warn('Storage quota high — pre-emptive eviction', {
        ratio: Number(snapshot.ratio.toFixed(3)),
        usageMB: Math.round(snapshot.usage / 1024 / 1024),
        quotaMB: Math.round(snapshot.quota / 1024 / 1024),
      });
      try {
        await evictor();
      } catch (e) {
        log.warn('Pre-emptive eviction failed', {error: unwrapAbortError(e)});
      }
    }
  }

  try {
    await table.bulkPut(records as T[]);
    return;
  } catch (e) {
    if (!isQuotaExceeded(e)) {
      log.error('bulkPut failed', {
        error: unwrapAbortError(e),
        records: records.length,
      });
      throw e;
    }
    log.warn('QuotaExceededError on bulkPut — evicting and retrying', {
      records: records.length,
    });
    await evictor();
  }

  // Single retry. Another QuotaExceededError here means eviction did
  // not free enough — surface the failure rather than loop.
  await table.bulkPut(records as T[]);
}

/** Ask the browser for persistent storage. Idempotent across calls
 *  (localStorage flag) so it is safe to call after every sync. Returns
 *  `true` if persistence is granted (or already was), `false` otherwise. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (localStorage.getItem(PERSIST_FLAG) === '1') return true;
  } catch {
    // localStorage may throw in sandboxed/private mode — proceed.
  }
  if (
    typeof navigator === 'undefined' ||
    !('storage' in navigator) ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return false;
  }
  try {
    const granted = await navigator.storage.persist();
    if (granted) {
      log.info('Persistent storage granted');
      try {
        localStorage.setItem(PERSIST_FLAG, '1');
      } catch {
        // ignore
      }
    }
    return granted;
  } catch (e) {
    log.warn('navigator.storage.persist threw', {
      error: unwrapAbortError(e),
    });
    return false;
  }
}

/**
 * Evict posts + piestats for the non-current user with the oldest
 * `danbooru_grass_last_sync_<uid>` timestamp. Returns the evicted uid,
 * or `null` if no eligible user was found.
 *
 * Hard guarantee: never deletes data for `currentUserId` — the active
 * profile's analytics correctness must not be sacrificed for the sake
 * of a write.
 */
export async function evictOldestNonCurrentUser(
  db: Database,
  currentUserId: number | string,
): Promise<number | null> {
  const currentId =
    typeof currentUserId === 'number'
      ? currentUserId
      : Number.parseInt(currentUserId, 10);

  let oldestUid: number | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;

  try {
    const allIds = await db.posts.orderBy('uploader_id').uniqueKeys();
    for (const uidRaw of allIds) {
      const uid = Number(uidRaw);
      if (!Number.isFinite(uid) || uid === currentId) continue;

      let syncStr: string | null = null;
      try {
        syncStr = localStorage.getItem(`${SYNC_KEY_PREFIX}${uid}`);
      } catch {
        // localStorage unavailable — treat as oldest.
      }
      const t = syncStr ? new Date(syncStr).getTime() : 0;
      if (t < oldestTime) {
        oldestTime = t;
        oldestUid = uid;
      }
    }

    if (oldestUid === null) {
      log.info('No non-current user available for eviction');
      return null;
    }

    await db.posts.where('uploader_id').equals(oldestUid).delete();
    await db.piestats.where('userId').equals(oldestUid).delete();

    try {
      localStorage.removeItem(`${SYNC_KEY_PREFIX}${oldestUid}`);
    } catch {
      // ignore
    }

    log.info('Evicted oldest non-current user', {
      uid: oldestUid,
      lastSyncMs: Number.isFinite(oldestTime) ? oldestTime : null,
    });
    return oldestUid;
  } catch (e) {
    log.warn('Eviction failed', {error: unwrapAbortError(e)});
    return null;
  }
}
