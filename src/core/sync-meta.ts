/**
 * Per-user sync state in `sync_meta` (schema v13, `SyncMetaRecord`) and the
 * small readings that go into it.
 */
import {createLogger} from './logger';
import type {Database} from './database';
import type {SyncMetaRecord} from '../types';

const log = createLogger('SyncMeta');

/**
 * Merges `patch` into the user's row (created if missing), read and written
 * in one transaction so two tabs cannot drop each other's fields. A failure
 * is logged and reported as false: sync state must not fail a sync.
 */
export async function patchSyncMeta(
  db: Database,
  userId: number,
  patch: Partial<Omit<SyncMetaRecord, 'userId'>>,
): Promise<boolean> {
  if (!db.sync_meta) return false;
  try {
    await db.transaction('rw', db.sync_meta, async () => {
      const current = await db.sync_meta.get(userId);
      await db.sync_meta.put({...current, ...patch, userId});
    });
    return true;
  } catch (e) {
    log.warn('Failed to write sync_meta', {userId, error: e});
    return false;
  }
}

/**
 * The server's clock at a response, from its `Date` header (ms since
 * epoch; one-second precision), or `fallback` when there is none. Change
 * watermarks are compared with the server's `updated_at`, so the client's
 * clock, which may be off, is only a last resort.
 */
export function responseServerTime(resp: Response, fallback: number): number {
  const header = resp.headers?.get?.('date');
  const t = header ? Date.parse(header) : NaN;
  return Number.isNaN(t) ? fallback : t;
}

/**
 * The viewer's Danbooru time zone (`<body data-current-user-time-zone>`),
 * which decides the dates in `created_at` strings; undefined off a
 * Danbooru page.
 */
export function viewerTimeZone(): string | undefined {
  if (typeof document === 'undefined' || !document.body) return undefined;
  return document.body.dataset.currentUserTimeZone || undefined;
}
